import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import SocketTransport from '../src/services/palringo/transport/SocketTransport.js';
import AppCheckRegistry from '../src/services/appCheck/AppCheckRegistry.js';
import { inspectAppCheckToken } from '../src/services/appCheck/token.js';
import { normalizeAppCheckProxy } from '../src/services/appCheck/proxy.js';
import { verifyAppCheckConnection } from '../src/services/appCheck/verifyAppCheckConnection.js';
import BotStateManager from '../src/services/BotStateManager.js';
import { cancelAdCampaignMonitor, startAdCampaignMonitor } from '../src/services/utils/adBot/campaignAvailability.js';
import { preflightAppCheck } from '../src/services/utils/autoRun/handleAutoRun.js';
import { buildAnonymousConnection } from '../src/services/AnonymousClassificationBot.js';
import BrowserAppCheckAcquirer from '../src/services/appCheck/BrowserAppCheckAcquirer.js';

function jwt (overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: 'https://firebaseappcheck.googleapis.com/390750556641',
    aud: ['projects/390750556641', 'projects/palringo-client'],
    sub: '1:390750556641:web:dfa97389209978e935c2a0',
    provider: 'recaptcha_enterprise',
    iat: now,
    exp: now + 3600,
    ...overrides
  };
  return `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

function verificationSocketFactory (welcome, capture) {
  return (url, options) => {
    capture.url = url;
    capture.options = options;
    const socket = new EventEmitter();
    socket.io = new EventEmitter();
    socket.connect = () => queueMicrotask(() => socket.emit('welcome', welcome));
    socket.disconnect = () => { capture.disconnected = true; };
    return socket;
  };
}

test('browser App Check acquisition automatically replaces a failed first browser attempt', async () => {
  const progress = [];
  const acquirer = new BrowserAppCheckAcquirer({
    timeoutMs: 1000,
    semaphore: { run: async task => await task() }
  });
  let attempts = 0;
  acquirer.acquireOwnedBrowser = async () => {
    attempts++;
    if (attempts === 1) { throw new Error('first browser entered reconnect screen'); }
    return { token: 'safe-token', fingerprint: 'safe-fingerprint' };
  };

  const result = await acquirer.acquire({
    targetType: 'classification',
    onProgress: update => progress.push(update)
  });

  assert.equal(result.token, 'safe-token');
  assert.equal(attempts, 2);
  assert.ok(progress.some(update => update.state === 'retrying-browser' && update.attempt === 2));
});

test('App Check JWT validation enforces the WOLF Firebase identity and minimum lifetime', () => {
  const valid = inspectAppCheckToken(jwt());
  assert.ok(valid.expiresAt > Date.now());
  assert.throws(() => inspectAppCheckToken(jwt({ provider: 'debug' })), /Invalid App Check token/);
  assert.throws(() => inspectAppCheckToken(jwt({ exp: Math.floor(Date.now() / 1000) + 60 })), /Invalid App Check token/);
});

test('configured App Check proxies are strict and never silently normalized to direct', () => {
  assert.deepEqual(normalizeAppCheckProxy({ host: '', port: '' }), { enabled: false, host: '', port: 0 });
  assert.deepEqual(normalizeAppCheckProxy({ enabled: false, host: 'partially-filled', port: 0 }), {
    enabled: false, host: '', port: 0
  });
  assert.deepEqual(normalizeAppCheckProxy({ host: ' 127.0.0.1 ', port: '8080' }), {
    enabled: true, host: '127.0.0.1', port: 8080, protocol: 'http'
  });
  assert.throws(() => normalizeAppCheckProxy({ host: '127.0.0.1', port: 'bad' }), /Invalid proxy port/);
});

test('authenticated ACT verification uses the submitted account token with the mobile connection', async () => {
  const capture = {};
  const result = await verifyAppCheckConnection({
    appCheckToken: 'safe-app-check-token',
    accessToken: 'safe-account-token',
    targetType: 'main',
    socketFactory: verificationSocketFactory({ loggedInUser: { id: 123 } }, capture)
  });
  assert.equal(capture.options.query.token, 'safe-account-token');
  assert.equal(capture.options.query.device, 'mobile');
  assert.equal(capture.options.query.appCheckToken, 'safe-app-check-token');
  assert.equal('state' in capture.options.query, false);
  assert.equal('version' in capture.options.query, false);
  assert.equal(capture.options.extraHeaders['x-app-check-token'], 'safe-app-check-token');
  assert.equal(result.subscriberId, 123);
  assert.equal(capture.disconnected, true);
});

test('classification ACT verification remains anonymous and uses a generated web token', async () => {
  const capture = {};
  const result = await verifyAppCheckConnection({
    appCheckToken: 'safe-app-check-token',
    targetType: 'classification',
    socketFactory: verificationSocketFactory({}, capture)
  });
  assert.match(capture.options.query.token, /^wjs-/);
  assert.equal(capture.options.query.device, 'web');
  assert.equal('state' in capture.options.query, false);
  assert.equal('version' in capture.options.query, false);
  assert.equal(result.authenticated, false);
});

test('a classification ACT record keeps one anonymous identity across verification and pool sockets', async () => {
  const acquisitionArguments = [];
  const manager = {
    emit: () => {},
    isAppCheckPaused: () => false,
    removeAppCheckPauseReason: () => {},
    addAppCheckPauseReason: () => {},
    getMainBot: () => null
  };
  const registry = new AppCheckRegistry(manager, {
    acquirer: {
      acquire: async options => {
        acquisitionArguments.push(options);
        return {
          token: `safe-token-${acquisitionArguments.length}`,
          fingerprint: `fingerprint-${acquisitionArguments.length}`,
          issuedAt: Date.now(),
          expiresAt: Date.now() + 3600000,
          anonymousToken: 'wjs-browser-identity',
          wolfConnection: { host: 'v3.palringo.com', port: 443 }
        };
      }
    }
  });
  const first = await registry.ensure({ type: 'classification', proxy: {} });
  await registry.ensure({ type: 'classification', proxy: {} }, { force: true });
  assert.match(acquisitionArguments[0].anonymousToken, /^wjs-/);
  assert.equal(first.anonymousToken, 'wjs-browser-identity');
  assert.equal(acquisitionArguments[1].anonymousToken, first.anonymousToken);
  assert.equal(buildAnonymousConnection({ anonymousToken: first.anonymousToken }).options.query.token, first.anonymousToken);
  assert.equal(first.wolfConnection.host, 'v3.palringo.com');
  await registry.destroy();
});

test('classification sockets use the gateway that welcomed the acquired browser identity', async () => {
  const manager = new BotStateManager({
    baseConfig: { botType: 'ad', excludeAdmins: true },
    mainBotConfig: {},
    roomBotConfig: {},
    classificationBotConfig: { host: 'wss://v3-rc.palringo.com', port: 443 },
    adBotConfig: []
  });
  const record = manager.appCheckRegistry.createOrReplace({ type: 'classification', proxy: {} });
  record.token = 'safe-token';
  record.expiresAt = Date.now() + 3600000;
  record.state = 'ready';
  record.anonymousToken = 'wjs-browser-identity';
  record.wolfConnection = { host: 'v3.palringo.com', port: 443 };

  const descriptor = manager.getConnectionDescriptor('classification');

  assert.equal(descriptor.config.host, 'wss://v3.palringo.com');
  assert.equal(descriptor.config.port, 443);
  assert.equal(descriptor.config.anonymousToken, 'wjs-browser-identity');
  await manager.appCheckRegistry.destroy();
});

test('authenticated sockets use the same gateway that welcomed their ACT', async () => {
  const manager = new BotStateManager({
    baseConfig: { botType: 'ad', excludeAdmins: false },
    mainBotConfig: { host: 'wss://v3-rc.palringo.com', port: 443, token: 'account-token' },
    roomBotConfig: {},
    classificationBotConfig: {},
    adBotConfig: []
  });
  const record = manager.appCheckRegistry.createOrReplace({
    type: 'main', accessToken: 'account-token', proxy: {}
  });
  record.token = 'safe-token';
  record.expiresAt = Date.now() + 3600000;
  record.state = 'ready';
  record.wolfConnection = { host: 'v3.palringo.com', port: 443 };

  const descriptor = manager.getConnectionDescriptor('main');

  assert.equal(descriptor.config.host, 'wss://v3.palringo.com');
  assert.equal(descriptor.config.port, 443);
  assert.equal(descriptor.config.token, 'account-token');
  await manager.appCheckRegistry.destroy();
});

test('live transport ACT replacement synchronizes query and header before reconnect', () => {
  const manager = new EventEmitter();
  manager.opts = { query: { token: 'account', appCheckToken: 'old' }, extraHeaders: { 'x-app-check-token': 'old' } };
  let reconnection = false;
  manager.reconnection = value => { reconnection = value; };
  const socket = new EventEmitter();
  socket.io = manager;
  socket.connected = false;
  socket.connect = () => { socket.connectCalled = true; };
  const transport = new SocketTransport({
    token: 'account', appCheckToken: 'old', appCheckValidator: () => true
  });
  transport.socket = socket;
  transport.closed = false;
  transport.replaceAppCheckToken('replacement', Date.now() + 3600000);
  transport.resumeAfterAppCheck();
  assert.equal(manager.opts.query.appCheckToken, 'replacement');
  assert.equal(manager.opts.extraHeaders['x-app-check-token'], 'replacement');
  assert.equal(reconnection, true);
  assert.equal(socket.connectCalled, true);
});

test('authenticated transport handshake omits rejected legacy state and version fields', () => {
  const transport = new SocketTransport({
    token: 'account-token',
    device: 'mobile',
    appCheckToken: 'safe-app-check-token',
    appCheckExpiresAt: Date.now() + 3600000
  });
  const { options } = transport.buildConnection();

  assert.equal(options.query.device, 'mobile');
  assert.equal(options.query.appCheckToken, 'safe-app-check-token');
  assert.equal('state' in options.query, false);
  assert.equal('version' in options.query, false);
});

test('record retries resume a suspended continuation once and preserve proxy identity', async () => {
  let attempts = 0;
  let resumed = 0;
  const acquisitionArguments = [];
  const manager = {
    emit: () => {},
    isAppCheckPaused: () => false,
    removeAppCheckPauseReason: () => {},
    addAppCheckPauseReason: () => {},
    getMainBot: () => null
  };
  const registry = new AppCheckRegistry(manager, {
    acquirer: {
      acquire: async options => {
        acquisitionArguments.push(options);
        attempts++;
        if (attempts === 1) { throw new Error('proxy acquisition failed'); }
        return { token: 'safe-test-token', fingerprint: 'unique', issuedAt: Date.now(), expiresAt: Date.now() + 3600000 };
      }
    }
  });
  await assert.rejects(registry.ensure({ type: 'room', index: 0, accessToken: 'secret', proxy: { host: 'proxy', port: 8080 } }, {
    continuationKey: 'room-command', continuation: async () => { resumed++; }
  }), /proxy acquisition failed/);
  const result = await registry.retryFailed();
  assert.equal(result.failures.length, 0);
  assert.equal(resumed, 1);
  assert.equal(registry.get('room', 0).proxy.host, 'proxy');
  assert.equal(registry.get('room', 0).accessToken, 'secret');
  assert.equal(acquisitionArguments[0].accessToken, 'secret');
  assert.equal(acquisitionArguments[0].targetType, 'room');
  assert.equal(acquisitionArguments[0].accountIndex, 0);
  await registry.retryFailed();
  assert.equal(resumed, 1);
  await registry.destroy();
});

test('a successful initial acquisition never replays its recovery continuation during refresh', async () => {
  let resumed = 0;
  let tokenNumber = 0;
  const manager = {
    emit: () => {},
    isAppCheckPaused: () => false,
    removeAppCheckPauseReason: () => {},
    addAppCheckPauseReason: () => {},
    getMainBot: () => null
  };
  const registry = new AppCheckRegistry(manager, {
    acquirer: {
      acquire: async () => ({
        token: `safe-test-token-${++tokenNumber}`,
        fingerprint: `unique-${tokenNumber}`,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000
      })
    }
  });
  const target = { type: 'ad', index: 0, accessToken: 'secret', proxy: {} };
  await registry.ensure(target, {
    continuationKey: 'ad-command', continuation: async () => { resumed++; }
  });
  await registry.ensure(target, { force: true });
  assert.equal(resumed, 0);
  await registry.destroy();
});

test('an expired record receives only one automatic final acquisition attempt', async () => {
  let attempts = 0;
  const now = Date.now();
  const manager = {
    emit: () => {},
    isAppCheckPaused: () => false,
    removeAppCheckPauseReason: () => {},
    addAppCheckPauseReason: () => {},
    isAppCheckRecordRequired: () => true,
    hasActiveHelperWork: () => false,
    disconnectIdleMainForAppCheck: async () => {},
    getMainBot: () => null
  };
  const registry = new AppCheckRegistry(manager, {
    clock: () => now,
    acquirer: { acquire: async () => { attempts++; throw new Error('acquisition failed'); } }
  });
  const record = registry.createOrReplace({ type: 'main', accessToken: 'secret', proxy: {} });
  record.state = 'warning';
  record.token = 'expired-test-token';
  record.expiresAt = now - 1;
  await registry.handleExpiry(record.id, record.generation);
  await registry.handleExpiry(record.id, record.generation);
  assert.equal(attempts, 1);
  await registry.destroy();
});

test('auto-run ACT preflight uses at most two workers and stops launching after a failure', async () => {
  let active = 0;
  let maximumActive = 0;
  const started = [];
  const botManager = {
    ensureAppCheck: async (_type, index) => {
      started.push(index);
      active++;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, index === 1 ? 5 : 20));
      active--;
      if (index === 1) { throw new Error('preflight failed'); }
    },
    startAutoRunTask: () => {}
  };
  const targets = Array.from({ length: 6 }, (_, index) => ({ type: 'room', index, accessToken: `token-${index}` }));
  await assert.rejects(preflightAppCheck(botManager, targets), /preflight failed/);
  assert.equal(maximumActive, 2);
  assert.deepEqual(started, [0, 1]);
  assert.equal(active, 0);
});

test('an ACT pause suspends the five-minute ad outage window and resume starts it from zero', async () => {
  const botManager = new BotStateManager({
    baseConfig: { botType: 'magic', excludeAdmins: false },
    mainBotConfig: {},
    roomBotConfig: { token: [] },
    classificationBotConfig: {},
    adBotConfig: [{ token: 'configured' }]
  });
  botManager._adCampaignOutageTimeoutMs = 25;
  botManager.adBots = [{ connected: false, disconnect: async () => {} }];
  startAdCampaignMonitor(botManager);
  botManager.addAppCheckPauseReason('ad:0');
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(botManager.adBots.length, 1);
  botManager.removeAppCheckPauseReason('ad:0');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(botManager.adBots.length, 1);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(botManager.adBots.length, 0);
  cancelAdCampaignMonitor(botManager);
  await botManager.appCheckRegistry.destroy();
});
