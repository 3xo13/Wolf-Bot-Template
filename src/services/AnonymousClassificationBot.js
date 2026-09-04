import { io } from 'socket.io-client';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

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

export function buildAnonymousConnection (config) {
  const host = String(config.host || 'wss://v3.palringo.com').replace(/^wss:/, 'https:');
  const agent = createProxyAgent(config.proxy);
  const options = {
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
    reconnectionAttempts: Infinity,
    timeout: CONNECT_TIMEOUT,
    query: { device: 'web' }
  };
  if (agent) { options.agent = agent; }
  return { url: `${host}:${config.port || 443}/`, options };
}

export default class AnonymousClassificationBot {
  constructor (manager, index) {
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
    const config = this.manager.config.roomBotConfig;
    const { url, options } = buildAnonymousConnection(config);
    this.socket = io(url, options);

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
      const cleanup = () => {
        this.socket?.off('welcome', onWelcome);
        this.socket?.off('connect_error', onError);
        this.cancelPendingConnect = null;
      };
      this.cancelPendingConnect = () => finish(reject, new Error('Classification bot is closed'));
      this.socket.on('welcome', onWelcome);
      this.socket.on('connect_error', onError);
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
