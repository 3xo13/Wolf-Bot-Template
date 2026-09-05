import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import CustomWOLF from '../src/services/CustomWOLF.js';
import MemberService from '../src/services/palringo/channels/MemberService.js';
import { COMMANDS } from '../src/services/palringo/constants.js';
import { PalringoClient, PalringoConnectionError } from '../src/services/palringo/index.js';
import { buildTextMessages } from '../src/services/palringo/messaging/buildTextMessages.js';
import RequestDispatcher from '../src/services/palringo/protocol/RequestDispatcher.js';

class FakeManager extends EventEmitter {
  reconnection (enabled) {
    this.reconnectionEnabled = enabled;
  }

  reconnectionDelay (milliseconds) {
    this.delay = milliseconds;
  }
}

class FakeSocket extends EventEmitter {
  constructor ({ failConnection = false, subscriber = { id: 42 } } = {}) {
    super();
    this.connected = false;
    this.failConnection = failConnection;
    this.subscriber = subscriber;
    this.io = new FakeManager();
    this.anyListeners = new Set();
    this.requests = [];
    this.disconnected = false;
  }

  onAny (listener) {
    this.anyListeners.add(listener);
  }

  connect () {
    queueMicrotask(() => {
      if (this.failConnection) {
        super.emit('connect_error', new Error('unavailable'));
        return;
      }
      this.connected = true;
      super.emit('connect');
      this.serverEvent('welcome', { loggedInUser: this.subscriber });
    });
    return this;
  }

  disconnect () {
    this.disconnected = true;
    this.connected = false;
    return this;
  }

  emit (event, ...args) {
    if (typeof args.at(-1) === 'function') {
      this.emitRequest(event, ...args);
      return true;
    }
    return super.emit(event, ...args);
  }

  emitRequest (event, payload, acknowledge) {
    this.requests.push({ event, payload });
    queueMicrotask(() => acknowledge({ success: true, code: 200, body: [] }));
  }

  serverEvent (event, payload) {
    super.emit(event, payload);
    for (const listener of this.anyListeners) { listener(event, payload); }
  }
}

const turn = () => new Promise(resolve => setImmediate(resolve));

test('request dispatcher retries bounded retryable responses', async () => {
  const calls = [];
  const responses = [{ code: 503 }, { code: 503 }, { code: 200, body: { ok: true } }];
  const dispatcher = new RequestDispatcher({
    emitWithAck: async (command, payload) => {
      calls.push({ command, payload });
      return responses.shift();
    }
  }, { maxRequestAttempts: 3, retryDelay: 0 });

  const response = await dispatcher.request('sample command', { id: 7 });

  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].payload, { body: { id: 7 } });
  assert.deepEqual(response.body, { ok: true });
});

test('request dispatcher does not retry transport failures by default', async () => {
  let calls = 0;
  const dispatcher = new RequestDispatcher({
    emitWithAck: async () => {
      calls++;
      throw new PalringoConnectionError('offline');
    }
  }, { maxRequestAttempts: 3, retryDelay: 0 });

  await assert.rejects(dispatcher.request('sample command', {}), /Request failed/u);
  assert.equal(calls, 1);
});

test('request dispatcher can return a final protocol failure without hiding transport failures', async () => {
  const protocolFailure = { code: 403, body: { reason: 'recipient unavailable' } };
  const dispatcher = new RequestDispatcher({
    emitWithAck: async () => protocolFailure
  }, { maxRequestAttempts: 1, retryDelay: 0 });

  assert.equal(
    await dispatcher.request('message send', {}, { throwOnFailure: false }),
    protocolFailure
  );
});

test('messaging preserves wolf.js non-success response semantics', async () => {
  const socket = new FakeSocket();
  socket.emitRequest = function (event, payload, acknowledge) {
    this.requests.push({ event, payload });
    queueMicrotask(() => acknowledge(
      event === COMMANDS.messageSend
        ? { code: 403, body: { reason: 'recipient unavailable' } }
        : { code: 200, body: [] }
    ));
  };
  const client = new PalringoClient({
    token: 'WE-test',
    connectTimeout: 100,
    authenticationTimeout: 100
  }, { socketFactory: () => socket });
  await client.connect();

  const response = await client.messaging.sendPrivateMessage(84035866, 'سلام');

  assert.equal(response.code, 403);
  assert.equal(socket.requests.at(-1).event, COMMANDS.messageSend);
  await client.destroy();
});

test('text messages are bounded and retain link metadata', async () => {
  const prefix = 'See [site](https://example.com) and [lobby] ';
  const messages = await buildTextMessages({
    recipient: 123,
    content: `${prefix}${'word '.repeat(450)}`,
    formatting: { includeEmbeds: true },
    resolveChannelByName: async name => name === 'lobby' ? { id: 99 } : undefined,
    flightIdFactory: () => 'fixed-flight-id'
  });

  assert.ok(messages.length > 1);
  assert.ok(messages.every(message => message.data.toString('utf8').length <= 1000));
  assert.equal(messages[0].metadata.formatting.links[0].url, 'https://example.com');
  assert.equal(messages[0].metadata.formatting.groupLinks[0].groupId, 99);
  assert.deepEqual(messages[0].embeds, [{ type: 'groupPreview', groupId: 99 }]);
  assert.equal(messages.filter(message => message.embeds).length, 1);
});

test('member service paginates regular members and preserves privileged request shape', async () => {
  const requests = [];
  const client = {
    request: async (command, payload) => {
      requests.push({ command, payload });
      if (command === COMMANDS.groupMemberPrivilegedList) {
        return { success: true, body: [{ id: 8 }] };
      }
      return payload.body.after
        ? { success: true, body: [{ id: 3 }] }
        : { success: true, body: [{ id: 1 }, { id: 2 }] };
    }
  };
  const members = new MemberService(client);

  assert.deepEqual(await members.list(55, 'regular', { pageSize: 2 }), [
    { id: 1 }, { id: 2 }, { id: 3 }
  ]);
  assert.equal(requests[1].payload.body.after, 2);

  requests.length = 0;
  assert.deepEqual(await members.list(55, 'privileged'), [{ id: 8 }]);
  assert.deepEqual(requests[0].payload.body, { id: 55, subscribe: true });
  assert.equal(requests.length, 1);
});

test('client authenticates, exposes compatibility helpers and normalizes activity', async () => {
  const socket = new FakeSocket();
  const client = new PalringoClient({
    token: 'WE-test',
    connectTimeout: 100,
    authenticationTimeout: 100
  }, { socketFactory: () => socket });
  let message;
  let activity;
  client.on('channelMessage', value => { message = value; });
  client.on('channelAudioSlotUpdate', value => { activity = value; });

  const subscriber = await client.connect();
  assert.equal(subscriber.id, 42);
  assert.equal(client.connected, true);
  assert.equal(client.channel, client.channels);
  assert.equal(client.stage.slot, client.stage);
  assert.equal(client.websocket.socket, socket);

  socket.serverEvent('message send', {
    body: {
      data: Buffer.from('hello'),
      isGroup: true,
      originator: { id: 17 },
      recipient: { id: 88 },
      mimeType: 'text/plain'
    }
  });
  socket.serverEvent('group audio slot update', {
    body: { id: 88, sourceSubscriberId: 18, slot: { id: 2, occupierId: 19 } }
  });
  await turn();

  assert.equal(message.body, 'hello');
  assert.equal(message.sourceSubscriberId, 17);
  assert.equal(message.targetChannelId, 88);
  assert.equal(activity.channelId, 88);
  assert.equal(activity.occupierId, 19);

  await client.websocket.emit('sample command', { value: true });
  assert.deepEqual(socket.requests.at(-1), {
    event: 'sample command',
    payload: { body: { value: true } }
  });

  await client.destroy();
  assert.equal(socket.disconnected, true);
  assert.equal(client.state, 'closed');
});

test('failed initial transport is disposed without waiting for authentication timeout', async () => {
  const socket = new FakeSocket({ failConnection: true });
  const client = new PalringoClient({
    token: 'WE-test',
    connectTimeout: 100,
    authenticationTimeout: 10000
  }, { socketFactory: () => socket });

  await assert.rejects(client.connect(), /Socket connection failed/u);
  assert.equal(socket.disconnected, true);
  assert.equal(client.transport.socket, null);
  assert.equal(client.state, 'disconnected');
});

test('application adapter logs in through PalringoClient and establishes main subscriptions', async () => {
  const socket = new FakeSocket({ subscriber: { id: 84, nickname: 'manager' } });
  const bot = new CustomWOLF(null, 'main', { socketFactory: () => socket });

  const subscriber = await bot.login({ token: 'WE-test' });

  assert.equal(subscriber.id, 84);
  assert.equal(bot.connected, true);
  assert.deepEqual(socket.requests.map(request => request.event), [
    COMMANDS.messagePrivateSubscribe,
    COMMANDS.messageGroupSubscribe
  ]);

  await bot.disconnect();
  assert.equal(bot.connected, false);
});
