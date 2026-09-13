import { io } from 'socket.io-client';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { randomUUID } from 'node:crypto';

const CONNECT_TIMEOUT = 15000;
const REQUEST_TIMEOUT = 30000;

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function createProxyAgent (proxy) {
  if (!proxy?.enabled || !proxy.host || !proxy.port) { return null; }
  let url = `${proxy.protocol || 'http'}://`;
  if (proxy.username && proxy.password) {
    url += `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`;
  }
  url += `${proxy.host}:${proxy.port}`;
  return ['socks', 'socks5'].includes(proxy.protocol)
    ? new SocksProxyAgent(url)
    : new HttpsProxyAgent(url);
}

function classificationObjectionError (value) {
  const body = value?.body ?? value ?? {};
  const code = body.code ?? body.headers?.code;
  const subCode = body.subCode ?? body.headers?.subCode;
  const error = new Error(`Classification connection was rejected (${code ?? 'unknown'}:${subCode ?? 'unknown'})`);
  error.code = code;
  error.subCode = subCode;
  return error;
}

export function buildAnonymousConnection (config = {}) {
  const host = String(config?.host || 'wss://v3-rc.palringo.com').replace(/^wss:/, 'https:');
  const agent = createProxyAgent(config?.proxy);
  const options = {
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
    reconnectionAttempts: Infinity,
    timeout: CONNECT_TIMEOUT,
    forceNew: true,
    multiplex: false,
    query: {
      device: 'web',
      token: config.anonymousToken || `wjs-${randomUUID()}`,
      isAppCheckEnabled: 'true',
      ...(config.appCheckToken ? { appCheckToken: config.appCheckToken } : {})
    },
    extraHeaders: config.appCheckToken
      ? { 'x-app-check-token': config.appCheckToken }
      : undefined
  };
  if (agent) { options.agent = agent; }
  return { url: `${host}:${config.port || 443}/`, options };
}

export function getClassificationConnectionConfig (manager) {
  return manager.config.classificationBotConfig || {};
}

export default class AnonymousClassificationBot {
  constructor (manager, index, descriptor = {}, { socketFactory = io } = {}) {
    this.manager = manager;
    this.index = index;
    this.socket = null;
    this.connected = false;
    this.isWorking = false;
    this.cooldownUntil = 0;
    this.closed = false;
    this.reconnecting = false;
    this.pendingRequests = new Set();
    this.cancelPendingConnect = null;
    this.descriptor = descriptor;
    this.socketFactory = socketFactory;
  }

  get cooldownMilliseconds () {
    return this.manager.getBotType() === 'magic' ? 1000 : 350;
  }

  emitCount () {
    this.manager.emitClassificationBotCount();
  }

  async connect () {
    if (this.connected || this.socket?.connected) { return this; }
    this.closed = false;
    const config = { ...getClassificationConnectionConfig(this.manager), ...this.descriptor };
    const { url, options } = buildAnonymousConnection(config);
    if (!config.appCheckToken || !this.manager.appCheckRegistry?.get('classification')?.expiresAt ||
      this.manager.appCheckRegistry.get('classification').expiresAt <= Date.now()) {
      throw new Error('Classification App Check token is unavailable');
    }
    this.socket = this.socketFactory(url, options);

    this.socket.on('disconnect', () => {
      this.reconnecting = !this.closed;
      for (const pending of this.pendingRequests) {
        pending.reject(new Error('Classification connection was interrupted'));
      }
      if (this.connected) {
        this.connected = false;
        this.emitCount();
        this.manager.signalRecipientChange();
      }
    });
    this.socket.on('welcome', welcome => {
      if (welcome?.loggedInUser) {
        console.warn('Classification connection unexpectedly authenticated; closing it.');
        this.disconnect();
        return;
      }
      if (!this.connected) {
        this.connected = true;
        this.reconnecting = false;
        this.emitCount();
        this.manager.signalRecipientChange();
      }
    });
    this.socket.on('objection', _objection => {
      const wasConnected = this.connected;
      this.connected = false;
      this.reconnecting = false;
      if (wasConnected) { this.emitCount(); }
      this.manager.signalRecipientChange();
    });
    this.socket.io?.on?.('reconnect_attempt', () => {
      const record = this.manager.appCheckRegistry?.get('classification');
      if (!record?.token || record.expiresAt <= Date.now()) {
        this.socket?.io?.reconnection?.(false);
        this.manager.appCheckRegistry?.handleConsumerUnavailable?.('classification');
      }
    });

    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        cleanup();
        callback(value);
      };
      const timer = setTimeout(() => finish(reject, new Error('Anonymous classification connection timeout')), CONNECT_TIMEOUT);
      const onWelcome = welcome => {
        if (welcome?.loggedInUser) { return; }
        finish(resolve);
      };
      const onError = error => {
        finish(reject, error instanceof Error ? error : new Error(String(error)));
      };
      const onObjection = objection => finish(reject, classificationObjectionError(objection));
      const cleanup = () => {
        this.socket?.off('welcome', onWelcome);
        this.socket?.off('connect_error', onError);
        this.socket?.off('objection', onObjection);
        this.cancelPendingConnect = null;
      };
      this.cancelPendingConnect = () => finish(reject, new Error('Classification bot is closed'));
      this.socket.on('welcome', onWelcome);
      this.socket.on('connect_error', onError);
      this.socket.on('objection', onObjection);
    });
    return this;
  }

  async waitForRequestSlot () {
    while (!this.closed) {
      const readyAt = Math.max(this.cooldownUntil, this.manager.classificationRateLimitUntil || 0);
      const delay = readyAt - Date.now();
      if (delay <= 0) { return; }
      await wait(delay);
    }
    throw new Error('Classification bot is closed');
  }

  async requestProfiles (ids, extended) {
    await this.manager.waitForAppCheckResume();
    await this.waitForRequestSlot();
    if (!this.connected || !this.socket?.connected) { throw new Error('Classification bot is not connected'); }
    this.cooldownUntil = Date.now() + this.cooldownMilliseconds;
    const idList = [...new Set(ids.map(Number).filter(Number.isInteger))].slice(0, 50);
    const payload = {
      headers: { version: 4 },
      body: { idList, extended, subscribe: false }
    };
    const response = await new Promise((resolve, reject) => {
      let settled = false;
      const pending = {
        reject: error => finish(reject, error)
      };
      const finish = (callback, value) => {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        this.pendingRequests.delete(pending);
        callback(value);
      };
      const timer = setTimeout(() => finish(reject, new Error('Subscriber profile request timeout')), REQUEST_TIMEOUT);
      this.pendingRequests.add(pending);
      try {
        this.socket.emit('subscriber profile', payload, value => {
          finish(resolve, value);
        });
      } catch (error) {
        finish(reject, error instanceof Error ? error : new Error(String(error)));
      }
    });
    const code = Number(response?.code);
    if (code === 429) {
      this.manager.classificationRateLimitUntil = Math.max(
        this.manager.classificationRateLimitUntil || 0,
        Date.now() + 10000
      );
      this.manager.signalRecipientChange();
    }
    if (!(code >= 200 && code <= 299) && response?.success !== true) {
      const error = new Error(`Subscriber profile request failed (${response?.code ?? 'unknown'})`);
      error.code = response?.code;
      throw error;
    }
    return response;
  }

  replaceAppCheckToken (token, expiresAt) {
    this.descriptor = { ...this.descriptor, appCheckToken: token, appCheckExpiresAt: expiresAt };
    if (!this.socket?.io?.opts) { return; }
    this.socket.io.opts.query = { ...(this.socket.io.opts.query || {}) };
    if (token) { this.socket.io.opts.query.appCheckToken = token; } else { delete this.socket.io.opts.query.appCheckToken; }
    this.socket.io.opts.extraHeaders = token ? { 'x-app-check-token': token } : undefined;
    this.socket.io.reconnection?.(true);
    if (!this.socket.connected && !this.closed) { this.socket.connect(); }
  }

  pauseForAppCheck () {
    this.socket?.io?.reconnection?.(false);
  }

  async disconnect () {
    this.closed = true;
    this.reconnecting = false;
    this.cancelPendingConnect?.();
    this.cancelPendingConnect = null;
    for (const pending of this.pendingRequests) {
      pending.reject(new Error('Classification bot is closed'));
    }
    this.pendingRequests.clear();
    const wasConnected = this.connected;
    this.connected = false;
    this.isWorking = false;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    if (wasConnected) { this.emitCount(); }
    this.manager.signalRecipientChange();
  }
}
