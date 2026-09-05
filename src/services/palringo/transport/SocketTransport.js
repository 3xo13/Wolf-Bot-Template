import { EventEmitter } from 'events';
import { io } from 'socket.io-client';
import { DEFAULT_CONNECTION } from '../constants.js';
import { PalringoConnectionError } from '../errors.js';
import { normalizeEndpoint } from '../utils.js';
import { createProxyAgent } from './createProxyAgent.js';

export default class SocketTransport extends EventEmitter {
  constructor (config = {}, { socketFactory = io } = {}) {
    super();
    this.config = { ...DEFAULT_CONNECTION, ...config };
    this.socketFactory = socketFactory;
    this.socket = null;
    this.connected = false;
    this.closed = true;
    this.pendingRequests = new Set();
    this.cancelPendingOpen = null;
  }

  buildConnection () {
    const proxyAgent = createProxyAgent(this.config.proxy);
    const options = {
      transports: ['websocket'],
      autoConnect: false,
      reconnection: this.config.reconnection !== false,
      reconnectionDelay: this.config.reconnectionDelay,
      reconnectionDelayMax: this.config.reconnectionDelayMax,
      reconnectionAttempts: this.config.reconnectionAttempts ?? Infinity,
      forceNew: true,
      multiplex: false,
      timeout: this.config.connectTimeout,
      query: {
        token: this.config.token,
        device: this.config.device,
        isAppCheckEnabled: 'true',
        state: this.config.onlineState,
        version: this.config.version,
        ...(this.config.appCheckToken ? { appCheckToken: this.config.appCheckToken } : {})
      },
      extraHeaders: this.config.appCheckToken
        ? { 'x-app-check-token': this.config.appCheckToken }
        : undefined
    };
    if (proxyAgent) { options.agent = proxyAgent; }
    return {
      url: normalizeEndpoint(this.config.host, this.config.port),
      options
    };
  }

  createSocket () {
    const { url, options } = this.buildConnection();
    this.socket = this.socketFactory(url, options);

    this.socket.on('connect', () => {
      this.connected = true;
      this.emit('connect');
    });
    this.socket.on('disconnect', reason => {
      this.connected = false;
      this.rejectPending(new PalringoConnectionError('Connection interrupted', { reason }));
      this.emit('disconnect', reason);
      if (!this.closed && reason === 'io server disconnect') {
        this.socket?.connect();
      }
    });
    this.socket.on('connect_error', error => this.emit('connectError', error));
    this.socket.onAny((event, data) => this.emit('packet', event, data));
    this.socket.io?.on?.('reconnect_attempt', attempt => this.emit('reconnectAttempt', attempt));
    this.socket.io?.on?.('reconnect_failed', error => this.emit('reconnectFailed', error));
  }

  configure (config) {
    if (this.socket) {
      throw new PalringoConnectionError('Connection configuration cannot change while a socket exists');
    }
    this.config = { ...DEFAULT_CONNECTION, ...config };
  }

  async open () {
    if (this.connected && this.socket?.connected) { return; }
    if (!this.config.token) {
      throw new PalringoConnectionError('An authenticated connection requires a token');
    }
    if (!this.socket) { this.createSocket(); }
    this.closed = false;

    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        this.socket.off('connect', onConnect);
        this.socket.off('connect_error', onError);
        this.cancelPendingOpen = null;
        callback(value);
      };
      const onConnect = () => finish(resolve);
      const onError = error => finish(reject, new PalringoConnectionError('Socket connection failed', { cause: error }));
      const timer = setTimeout(
        () => finish(reject, new PalringoConnectionError('Socket connection timed out')),
        this.config.connectTimeout
      );
      this.socket.once('connect', onConnect);
      this.socket.once('connect_error', onError);
      this.cancelPendingOpen = error => finish(reject, error);
      this.socket.connect();
    });
  }

  async emitWithAck (event, payload, { timeout = this.config.requestTimeout } = {}) {
    if (!this.connected || !this.socket?.connected || this.closed) {
      throw new PalringoConnectionError('Socket is not connected');
    }

    return await new Promise((resolve, reject) => {
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
      const timer = setTimeout(
        () => finish(reject, new PalringoConnectionError(`Request timed out: ${event}`, { event })),
        timeout
      );
      this.pendingRequests.add(pending);

      try {
        const emitter = this.socket.volatile?.emit ? this.socket.volatile : this.socket;
        emitter.emit(event, payload, response => finish(resolve, response));
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  setReconnectDelay (milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) { return; }
    this.socket?.io?.reconnectionDelay?.(milliseconds);
  }

  disableReconnection () {
    this.socket?.io?.reconnection?.(false);
  }

  rejectPending (error) {
    for (const pending of this.pendingRequests) { pending.reject(error); }
    this.pendingRequests.clear();
  }

  async close () {
    this.closed = true;
    this.connected = false;
    this.disableReconnection();
    const error = new PalringoConnectionError('Connection closed');
    this.cancelPendingOpen?.(error);
    this.cancelPendingOpen = null;
    this.rejectPending(error);
    if (!this.socket) { return; }
    this.socket.removeAllListeners();
    this.socket.io?.removeAllListeners?.();
    this.socket.disconnect();
    this.socket = null;
  }
}
