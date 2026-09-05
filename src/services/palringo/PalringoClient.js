import { EventEmitter } from 'events';
import ChannelService from './channels/ChannelService.js';
import { DEFAULT_CONNECTION } from './constants.js';
import { PalringoAuthenticationError, PalringoConnectionError } from './errors.js';
import ProtocolEventRouter from './events/ProtocolEventRouter.js';
import MessagingService from './messaging/MessagingService.js';
import ProtocolSocket from './protocol/ProtocolSocket.js';
import RequestDispatcher from './protocol/RequestDispatcher.js';
import StageService from './stage/StageService.js';
import SocketTransport from './transport/SocketTransport.js';

export default class PalringoClient extends EventEmitter {
  constructor (config = {}, dependencies = {}) {
    super();
    this.config = { ...DEFAULT_CONNECTION, ...config };
    this.state = 'idle';
    this.authenticated = false;
    this.currentSubscriber = undefined;
    this.everReady = false;
    this.destroyed = false;
    this.connectTask = null;
    this.cancelAuthentication = null;

    this.transport = new SocketTransport(this.config, dependencies);
    this.dispatcher = new RequestDispatcher(this.transport, this.config);
    this.channels = new ChannelService(this);
    this.channel = this.channels;
    this.group = this.channels;
    this.messaging = new MessagingService(this);
    this.stage = new StageService(this);
    this.events = new ProtocolEventRouter(this);
    this.websocket = new ProtocolSocket(this);
    this.bindTransportEvents();
  }

  get connected () {
    return this.authenticated && this.transport.connected && this.state === 'ready';
  }

  bindTransportEvents () {
    this.transport.on('connect', () => {
      this.state = 'authenticating';
      this.emit('transportConnected');
    });
    this.transport.on('disconnect', reason => {
      this.authenticated = false;
      this.state = this.destroyed || this.transport.closed ? 'closed' : 'reconnecting';
      this.emit('disconnected', reason);
    });
    this.transport.on('connectError', error => this.emit('connectError', error));
    this.transport.on('reconnectAttempt', attempt => this.emit('reconnecting', attempt));
    this.transport.on('reconnectFailed', error => {
      this.state = 'disconnected';
      this.emit('reconnectFailed', error);
    });
    this.transport.on('packet', (event, packet) => {
      this.events.route(event, packet).catch(error => this.emit('internalError', error));
    });
  }

  async connect () {
    if (this.connected) { return this.currentSubscriber; }
    if (this.destroyed) { throw new PalringoConnectionError('Client has been destroyed'); }
    if (this.connectTask) { return await this.connectTask; }
    this.connectTask = this.openAndAuthenticate();
    try {
      return await this.connectTask;
    } finally {
      this.connectTask = null;
    }
  }

  async openAndAuthenticate () {
    this.state = 'connecting';
    const authentication = this.createAuthenticationWaiter();
    this.cancelAuthentication = authentication.cancel;
    try {
      await this.transport.open();
      return await authentication.promise;
    } catch (error) {
      authentication.promise.catch(() => {});
      authentication.cancel(error);
      await this.transport.close();
      this.state = 'disconnected';
      throw error;
    } finally {
      if (this.cancelAuthentication === authentication.cancel) {
        this.cancelAuthentication = null;
      }
    }
  }

  async login (config = {}) {
    if (this.transport.socket) {
      throw new PalringoConnectionError('Client already has an active connection');
    }
    this.config = { ...this.config, ...config };
    this.transport.configure(this.config);
    return await this.connect();
  }

  createAuthenticationWaiter () {
    let cancel;
    const promise = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        this.off('ready', onReady);
        this.off('resume', onReady);
        this.off('loginFailed', onFailure);
        callback(value);
      };
      const onReady = subscriber => finish(resolve, subscriber);
      const onFailure = error => finish(reject, error);
      cancel = error => finish(reject, error);
      const timer = setTimeout(
        () => finish(reject, new PalringoAuthenticationError('Authentication timed out')),
        this.config.authenticationTimeout
      );
      this.once('ready', onReady);
      this.once('resume', onReady);
      this.once('loginFailed', onFailure);
    });

    return { promise, cancel: error => cancel?.(error) };
  }

  async acceptWelcome (welcome) {
    const subscriber = welcome.loggedInUser ?? welcome.subscriber;
    if (!subscriber?.id) {
      this.acceptObjection({ message: 'Welcome did not contain an authenticated subscriber' });
      return;
    }

    const resumed = this.everReady;
    this.authenticated = true;
    this.currentSubscriber = subscriber;
    this.state = resumed ? 'restoring' : 'ready';
    this.everReady = true;

    if (resumed) {
      const results = await Promise.allSettled([
        this.messaging.restoreSubscriptions(),
        this.stage.restoreSubscriptions()
      ]);
      const failures = results.filter(result => result.status === 'rejected');
      if (failures.length) { this.emit('subscriptionRestoreFailed', failures.map(result => result.reason)); } else { this.emit('subscriptionsRestored'); }
    }

    this.state = 'ready';
    this.emit('welcome', { ...welcome, subscriber });
    this.emit(resumed ? 'resume' : 'ready', subscriber);
  }

  acceptObjection (objection) {
    const reconnectSeconds = Number(objection.reconnectSeconds ?? objection.headers?.reconnectSeconds);
    const error = new PalringoAuthenticationError(
      objection.message ?? objection.headers?.message ?? 'WOLF rejected the connection',
      {
        code: objection.code,
        subCode: objection.subCode ?? objection.headers?.subCode,
        reconnectSeconds: Number.isFinite(reconnectSeconds) ? reconnectSeconds : undefined,
        response: objection
      }
    );
    this.authenticated = false;
    this.state = reconnectSeconds === -1 ? 'rejected' : 'reconnecting';
    if (reconnectSeconds === -1) { this.transport.disableReconnection(); } else if (reconnectSeconds > 0) { this.transport.setReconnectDelay(reconnectSeconds * 1000); }
    this.emit('objection', error);
    this.emit('loginFailed', error);
  }

  async request (command, payload, options = {}) {
    if (options.requireReady !== false && !this.connected) {
      throw new PalringoConnectionError('Client is not authenticated and ready');
    }
    return await this.dispatcher.request(command, payload, options);
  }

  async disconnect () {
    this.authenticated = false;
    this.state = 'closed';
    this.cancelAuthentication?.(new PalringoConnectionError('Connection closed'));
    await this.transport.close();
    this.emit('closed');
  }

  async destroy () {
    if (this.destroyed) { return; }
    this.destroyed = true;
    await this.disconnect();
    this.channels.clear();
    this.stage.clear();
    this.removeAllListeners();
  }
}
