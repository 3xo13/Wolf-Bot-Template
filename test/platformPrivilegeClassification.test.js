import test from 'node:test';
import assert from 'node:assert/strict';
import BotStateManager from '../src/services/BotStateManager.js';
import { classifySubscriberPatch } from '../src/services/utils/classification/classifySubscribers.js';
import {
  EXCLUDED_PLATFORM_PRIVILEGES,
  isPlatformPrivileged
} from '../src/services/utils/classification/platformPrivileges.js';
import { handleGroupMessage } from '../src/services/utils/roomBot/magic/handleGroupMessage.js';
import { getAllChannelMembers } from '../src/services/utils/roomBot/getAllChannelMembers.js';
import {
  connectPreparationRoomBots,
  getLowRoomClassificationWorkerCount,
  handlePrepareCommand,
  releasePreparationRoomBots
} from '../src/services/utils/roomBot/handlePrepareCommand.js';
import {
  ensureClassificationBots,
  getClassificationBotTarget,
  startClassificationWorkers,
  assertRoomAccountClassificationCapacity,
  assertRoomBotPoolCapacity
} from '../src/services/utils/classification/classificationPool.js';
import AnonymousClassificationBot, {
  buildAnonymousConnection,
  getClassificationConnectionConfig
} from '../src/services/AnonymousClassificationBot.js';
import { sendUpdateEvent } from '../src/services/utils/updates/sendUpdateEvent.js';
import { buildStateReport } from '../src/services/utils/handleStateReport.js';
import { queueEligibleActivities, queueEligibleActivity } from '../src/services/utils/classification/magicQueue.js';
import { registerConnectedBot } from '../src/services/BotStateManagerMethods/connect.js';
import CustomWOLF from '../src/services/CustomWOLF.js';
import { handleReset } from '../src/services/utils/handleReset.js';
import { handleRoomCommand as handleNormalRoomCommand } from '../src/services/utils/roomBot/handleRoomCommand.js';
import {
  assertAdConnectionCooldownComplete,
  assertRoomConnectionCooldownComplete,
  clearAdConnectionCooldown,
  clearRoomConnectionCooldown,
  startAdConnectionCooldown,
  startRoomConnectionCooldown
} from '../src/services/utils/roomBot/roomConnectionCooldown.js';
import { connectBotBatch } from '../src/services/utils/connections/connectBotBatch.js';
import { rollbackAdAccountSetup } from '../src/services/utils/adBot/adAccountConnection.js';
import { handleStopCommand } from '../src/services/utils/adBot/handleStopCommand.js';
import { handleAdAccountCommand } from '../src/services/utils/adBot/handleAdAccountCommand.js';

function manager () {
  return new BotStateManager({
    baseConfig: { botType: 'ad', excludeAdmins: true },
    roomBotConfig: { token: [] },
    adBotConfig: []
  });
}

function fakeRoomBot (profileFor, requests) {
  return {
    connected: true,
    websocket: {
      emit: async (command, request) => {
        requests.push({ command, ...request.body });
        const body = {};
        request.body.idList.forEach(id => {
          body[id] = { success: true, body: profileFor(id, request.body.extended) };
        });
        return { success: true, body };
      }
    }
  };
}

const waitUntil = async (condition, timeout = 2000) => {
  const expires = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() >= expires) { throw new Error('Timed out waiting for condition'); }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

test('only the selected seven platform privileges are excluded', () => {
  Object.values(EXCLUDED_PLATFORM_PRIVILEGES).forEach(mask => assert.equal(isPlatformPrivileged(mask), true));
  [0, 1 << 2, 1 << 3, 1 << 20, 1 << 26].forEach(mask => assert.equal(isPlatformPrivileged(mask), false));
  assert.equal(isPlatformPrivileged(undefined), false);
});

test('raw profile classification is fail-closed and never exceeds 50 IDs', async () => {
  const botManager = manager();
  const requests = [];
  const ids = Array.from({ length: 75 }, (_, index) => String(index + 1));
  const roomBot = fakeRoomBot((id) => id === 3
    ? { id }
    : { id, privileges: id === 2 ? EXCLUDED_PLATFORM_PRIVILEGES.STAFF : 0 }, requests);

  const result = await classifySubscriberPatch(botManager, roomBot, ids, { attempts: 1 });
  assert.ok(requests.every(request => request.idList.length <= 50));
  assert.ok(requests.every(request => request.subscribe === false));
  assert.equal(botManager.excludedUsers.has('2'), true);
  assert.equal(botManager.eligibleUsers.has('1'), true);
  assert.equal(botManager.unknownUsers.has('3'), true);
  assert.equal(result.eligible.length + result.excluded.length + result.unknown.length, 50);
});

test('350,000 IDs remain deduplicated and are consumed in bounded 50-ID patches', () => {
  const botManager = manager();
  for (let id = 1; id <= 350000; id++) {
    botManager.enqueueCandidate(id);
    botManager.enqueueCandidate(id);
  }
  let consumed = 0;
  let patch;
  while ((patch = botManager.takeClassificationPatch(50)).length) {
    assert.ok(patch.length <= 50);
    consumed += patch.length;
  }
  assert.equal(consumed, 350000);
  assert.equal(botManager.seenUsers.size, 350000);
  assert.ok(botManager.classificationQueue.length < 10000);
});

test('room privileged members are fetched regardless of exclusion setting', async () => {
  const botManager = manager();
  const commands = [];
  const roomBot = {
    connected: true,
    websocket: {
      emit: async (command) => {
        commands.push(command);
        return { success: true, body: [] };
      }
    }
  };
  await getAllChannelMembers(botManager, roomBot, 10, 100);
  assert.ok(commands.includes('group member privileged list'));
});

test('magic mode coalesces duplicate events and remembers excluded IDs', async () => {
  const botManager = manager();
  botManager.config.baseConfig.botType = 'magic';
  botManager.currentStep = 6;
  const requests = [];
  const roomBot = fakeRoomBot(async () => ({}), requests);
  roomBot.websocket.emit = async (command, request) => {
    requests.push({ command, ...request.body });
    await new Promise(resolve => setTimeout(resolve, 5));
    const id = request.body.idList[0];
    return {
      success: true,
      body: { [id]: { success: true, body: { id, privileges: EXCLUDED_PLATFORM_PRIVILEGES.GROUP_ADMIN } } }
    };
  };
  botManager.roomBots = [roomBot];
  botManager.classificationBots = [roomBot];

  await Promise.all([
    handleGroupMessage(botManager, { sourceSubscriberId: 99 }, roomBot),
    handleGroupMessage(botManager, { sourceSubscriberId: 99 }, roomBot)
  ]);
  await waitUntil(() => botManager.excludedUsers.has('99'));
  await handleGroupMessage(botManager, { sourceSubscriberId: 99 }, roomBot);

  assert.equal(requests.length, 1);
  assert.equal(botManager.excludedUsers.has('99'), true);
  assert.equal(botManager.channelUsers.has('99'), false);
  botManager.cancelClassification();
});

test('magic member updates report the authoritative eligible total', async () => {
  const botManager = manager();
  botManager.config.baseConfig.botType = 'magic';
  for (let id = 1; id <= 47; id++) { botManager.eligibleUsers.add(String(id)); }
  for (let id = 1; id <= 5; id++) { botManager.channelUsers.set(String(id), { timer: 0 }); }
  const emitted = [];
  botManager.socket = {
    connected: true,
    emit: (event, payload) => emitted.push({ event, payload })
  };

  await queueEligibleActivity(botManager, '6');

  const memberUpdate = emitted.find(item => item.event === 'users:setup');
  assert.equal(memberUpdate.payload.users, 47);
});

test('a classified magic batch is distributed across all free ad bots', async () => {
  const botManager = manager();
  botManager.config.baseConfig.botType = 'magic';
  botManager.config.baseConfig.singleMessageMillisecInterval = 1;
  botManager.config.baseConfig.accountsMillisecInterval = 1;
  botManager.messages.add('advertisement');
  botManager.messageCount = 1;
  const sends = [];
  botManager.adBots = Array.from({ length: 30 }, (_, index) => ({
    isWorking: false,
    isBusy: false,
    setIsWorking (value) { this.isWorking = value; },
    setIsBusy (value) { this.isBusy = value; },
    messaging: {
      sendPrivateMessage: async userId => { sends.push({ bot: index, userId }); }
    }
  }));
  const ids = Array.from({ length: 31 }, (_, index) => String(index + 1));
  ids.forEach(id => botManager.eligibleUsers.add(id));

  await queueEligibleActivities(botManager, ids);
  await waitUntil(() => sends.length === 31);

  assert.equal(new Set(sends.slice(0, 30).map(send => send.bot)).size, 30);
  assert.deepEqual(sends.slice(0, 30).map(send => send.userId), Array.from({ length: 30 }, (_, index) => index + 1));
});

test('magic patch reservation prevents repeat sends during the grace period', async () => {
  const botManager = manager();
  botManager.config.baseConfig.botType = 'magic';
  botManager.config.baseConfig.channelMessagingTimer = 60;
  botManager.config.baseConfig.singleMessageMillisecInterval = 1;
  botManager.config.baseConfig.accountsMillisecInterval = 1;
  botManager.messages.add('advertisement');
  botManager.messageCount = 1;
  const sends = [];
  botManager.adBots = Array.from({ length: 30 }, (_, index) => ({
    isWorking: false,
    isBusy: false,
    setIsWorking (value) { this.isWorking = value; },
    setIsBusy (value) { this.isBusy = value; },
    messaging: {
      sendPrivateMessage: async userId => { sends.push({ bot: index, userId }); }
    }
  }));
  const ids = Array.from({ length: 30 }, (_, index) => String(index + 1));
  ids.forEach(id => botManager.eligibleUsers.add(id));

  await queueEligibleActivities(botManager, ids);
  await waitUntil(() => sends.length >= 1);

  // Member 30 is already reserved but has not reached its sequential send
  // invocation yet. A new activity must not put it back in the queue.
  await queueEligibleActivity(botManager, '30');
  await waitUntil(() => sends.length === 30);
  await new Promise(resolve => setTimeout(resolve, 100));

  assert.equal(sends.filter(send => send.userId === 30).length, 1);
  assert.equal(botManager.channelsAdsSent, 30);
  assert.equal(botManager.channelUsersToMessageQueue.size, 0);
});

test('low-room campaigns scale their classification-only worker pool', () => {
  assert.equal(getLowRoomClassificationWorkerCount(1, 5000), 0);
  assert.equal(getLowRoomClassificationWorkerCount(1, 5001), 3);
  assert.equal(getLowRoomClassificationWorkerCount(2, 49999), 3);
  assert.equal(getLowRoomClassificationWorkerCount(2, 50000), 5);
  assert.equal(getLowRoomClassificationWorkerCount(3, 75000), 0);
});

test('classification workers wait for full patches while extraction is active', () => {
  const botManager = manager();
  botManager.classificationProducers = 1;
  for (let id = 1; id <= 49; id++) { botManager.enqueueCandidate(id); }
  assert.deepEqual(botManager.takeClassificationPatch(50, false), []);
  botManager.enqueueCandidate(50);
  assert.equal(botManager.takeClassificationPatch(50, false).length, 50);

  botManager.enqueueCandidate(51);
  botManager.classificationProducers = 0;
  assert.deepEqual(botManager.takeClassificationPatch(50, true), ['51']);
});

test('normal classifiers consume a full FIFO patch before extraction finishes', async () => {
  const botManager = manager();
  const requests = [];
  const classifier = fakeRoomBot(id => ({ id, privileges: 0 }), requests);
  classifier.isWorking = false;
  botManager.classificationBots = [classifier];
  botManager.classificationProducers = 1;
  startClassificationWorkers(botManager);

  for (let id = 1; id <= 50; id++) { botManager.enqueueCandidate(id); }
  await waitUntil(() => requests.length === 1);

  assert.deepEqual(requests[0].idList, Array.from({ length: 50 }, (_, index) => index + 1));
  assert.equal(botManager.classificationProducers, 1);
  botManager.cancelClassification();
});

test('socket updates safely ignore a missing or disconnected manager', async () => {
  assert.equal(await sendUpdateEvent(undefined, 'test', {}), false);
  assert.equal(await sendUpdateEvent({ socket: { connected: false } }, 'test', {}), false);
});

test('idle status reports zero ads and includes total members above ads', () => {
  const report = buildStateReport({ botType: 'ad', users: 0, adsSent: 0 }, false);
  const usersPosition = report.indexOf('إجمالي الأعضاء : 0');
  const adsPosition = report.indexOf('عدد الاعلانات : 0');

  assert.ok(usersPosition >= 0);
  assert.ok(adsPosition > usersPosition);
  assert.ok(report.includes('حاله البوت : متوقف'));
});

test('magic status omits the total-user line', () => {
  const report = buildStateReport({ botType: 'magic', users: 12, adsSent: 4 }, true);

  assert.equal(report.includes('إجمالي الأعضاء'), false);
  assert.ok(report.includes('عدد الاعلانات : 4'));
  assert.ok(report.includes('حاله البوت : يعمل'));
});

test('disconnect cleanup immediately and idempotently disconnects every bot', async () => {
  const botManager = manager();
  let disconnects = 0;
  const bot = () => ({ disconnect: async () => { disconnects++; } });
  botManager.mainBot = bot();
  botManager.roomBots = [bot()];
  botManager.adBots = [bot()];
  botManager.classificationBots = [bot()];

  await Promise.all([
    botManager.clearForDisconnectState(),
    botManager.clearForDisconnectState()
  ]);

  assert.equal(disconnects, 4);
  assert.equal(botManager.roomBots.length, 0);
  assert.equal(botManager.adBots.length, 0);
  assert.equal(botManager.classificationBots.length, 0);
  assert.equal(botManager._destroyed, true);
});

test('command reset keeps the manager reusable and the main bot connected', async () => {
  const botManager = manager();
  const mainBot = { connected: true };
  botManager.mainBot = mainBot;
  botManager._destroyed = false;

  await botManager.resetState();

  assert.equal(botManager._destroyed, false);
  assert.equal(botManager.isClassificationCancelled(), false);
  assert.equal(botManager.getMainBot(), mainBot);
  assert.equal(botManager.getCurrentStep(), 1);
});

test('reset remains blocking until its final client notification is sent', async () => {
  const botManager = manager();
  botManager.config.baseConfig.orderFrom = 1;
  let releaseResetMessage;
  let markResetMessageStarted;
  const resetMessageStarted = new Promise(resolve => { markResetMessageStarted = resolve; });
  const resetMessageGate = new Promise(resolve => { releaseResetMessage = resolve; });
  const events = [];
  const mainBot = {
    connected: true,
    isBusy: false,
    messaging: {
      sendPrivateMessage: async () => {
        markResetMessageStarted();
        await resetMessageGate;
        return {};
      }
    }
  };
  botManager.mainBot = mainBot;
  botManager.socket = {
    connected: true,
    emit: (event, payload) => events.push({ event, payload })
  };

  const resetTask = handleReset(botManager);
  await resetMessageStarted;

  assert.equal(botManager.isReseting, true);
  releaseResetMessage();
  await resetTask;

  assert.equal(botManager.isReseting, false);
  assert.ok(events.some(item => item.event === 'state:reset'));
  assert.ok(botManager.roomConnectionCooldownUntil > Date.now());
  assert.ok(botManager.adConnectionCooldownUntil > Date.now());
  clearRoomConnectionCooldown(botManager);
  clearAdConnectionCooldown(botManager);
});

test('a room connection completed after reset cannot become an orphan', () => {
  const botManager = manager();
  const connectionGeneration = botManager._connectionGeneration;
  const roomBot = { connected: true };

  botManager._connectionGeneration++;

  assert.equal(registerConnectedBot(botManager, 'room', roomBot, connectionGeneration), false);
  assert.equal(botManager.roomBots.length, 0);
});

test('room connected event is emitted only after manager registration', () => {
  const botManager = manager();
  const events = [];
  botManager.socket = {
    connected: true,
    emit: (event, payload) => events.push({ event, payload })
  };
  const roomBot = {
    currentSubscriber: { id: 42, nickname: 'room' },
    connected: true
  };

  assert.equal(
    registerConnectedBot(botManager, 'room', roomBot, botManager._connectionGeneration),
    true
  );

  assert.deepEqual(botManager.roomBots, [roomBot]);
  assert.equal(roomBot._managerRegistered, true);
  assert.equal(events.filter(item => item.event === 'bots:room:connected').length, 1);
});

test('a rejected normal room login rolls back its provisional token', async () => {
  const botManager = manager();
  botManager.mainBot = { connected: true };
  botManager.connect = async () => { throw new Error('websocket error'); };

  await assert.rejects(
    handleNormalRoomCommand('WE-rejected-room-token', botManager),
    /websocket error/
  );

  assert.deepEqual(botManager.roomBotsTokens, []);
  assert.deepEqual(botManager.roomBots, []);
  assert.ok(botManager.roomConnectionCooldownUntil > Date.now());
  clearRoomConnectionCooldown(botManager);
});

test('room connection cooldown blocks commands and prompts when it expires', async () => {
  const botManager = manager();
  botManager.config.baseConfig.orderFrom = 1;
  const messages = [];
  botManager.mainBot = {
    connected: true,
    isBusy: false,
    messaging: {
      sendPrivateMessage: async (_subscriberId, message) => { messages.push(message); }
    }
  };

  startRoomConnectionCooldown(botManager, { duration: 25 });
  assert.throws(() => assertRoomConnectionCooldownComplete(botManager), /يرجى الانتظار/);
  await waitUntil(() => messages.length === 1);

  assert.doesNotThrow(() => assertRoomConnectionCooldownComplete(botManager));
  assert.match(messages[0], /حساب رومات/);

  startRoomConnectionCooldown(botManager, { duration: 25, nextCommand: 'prepare' });
  await waitUntil(() => messages.length === 2);
  assert.match(messages[1], /تجهيز/);
});

test('preparation cooldown rejects an early retry without clearing the primary room bot', async () => {
  const botManager = manager();
  const primaryRoomBot = { connected: true, currentSubscriber: { id: 1 } };
  botManager.roomBots = [primaryRoomBot];
  botManager.currentStep = 2;
  startRoomConnectionCooldown(botManager, { duration: 1000, nextCommand: 'prepare' });

  await assert.rejects(handlePrepareCommand(botManager), /يرجى الانتظار/);

  assert.deepEqual(botManager.roomBots, [primaryRoomBot]);
  assert.equal(botManager.isPreparing, false);
  clearRoomConnectionCooldown(botManager);
});

test('a cancelled preparation cannot clear a room bot added after reset', async () => {
  const botManager = manager();
  const preparationGeneration = botManager._classificationGeneration;
  let oldDisconnects = 0;
  let newDisconnects = 0;
  const oldProducer = { disconnect: async () => { oldDisconnects++; } };
  const newRoomBot = { disconnect: async () => { newDisconnects++; } };

  // Reset invalidates the extraction generation and installs a room bot for
  // the new session before the old preparation continuation settles.
  botManager._classificationGeneration++;
  botManager.roomBots = [newRoomBot];

  const released = await releasePreparationRoomBots(
    botManager,
    [oldProducer],
    preparationGeneration
  );

  assert.equal(released, false);
  assert.deepEqual(botManager.roomBots, [newRoomBot]);
  assert.equal(oldDisconnects, 0);
  assert.equal(newDisconnects, 0);
});

test('failed room-pool creation waits for every connection attempt to settle', async () => {
  const connectedBots = Array.from({ length: 4 }, (_, index) => ({ id: index + 1 }));
  let call = 0;
  const botManager = {
    connect: async () => {
      const index = call++;
      if (index === 0) { throw new Error('Connection timeout after 15 seconds'); }
      await new Promise(resolve => setTimeout(resolve, 5));
      return connectedBots[index - 1];
    }
  };

  const result = await connectPreparationRoomBots(botManager, 5);

  assert.match(result.error.message, /Connection timeout/);
  assert.deepEqual(result.bots, []);
  assert.equal(call, 5);
});

test('failed room-pool rollback keeps only the main room bot', async () => {
  const botManager = manager();
  let mainDisconnects = 0;
  let additionalDisconnects = 0;
  const mainRoomBot = { disconnect: async () => { mainDisconnects++; } };
  const additionalRoomBots = Array.from({ length: 4 }, () => ({
    disconnect: async () => { additionalDisconnects++; }
  }));
  botManager.roomBots = [mainRoomBot, ...additionalRoomBots];

  await botManager.clearRoomBots(additionalRoomBots);

  assert.deepEqual(botManager.roomBots, [mainRoomBot]);
  assert.equal(mainDisconnects, 0);
  assert.equal(additionalDisconnects, 4);
});

test('room disconnect disables Socket.IO reconnection even between connections', async () => {
  const botManager = manager();
  botManager.socket = null;
  let reconnectionSetting = true;
  let socketDisconnects = 0;
  const roomBot = Object.create(CustomWOLF.prototype);
  roomBot.botType = 'room';
  roomBot.botManager = botManager;
  roomBot.transport = { close: async () => {} };
  roomBot.websocket = {
    socket: {
      connected: false,
      io: { reconnection: value => { reconnectionSetting = value; } },
      disconnect: () => { socketDisconnects++; }
    },
    disconnect: async () => {}
  };

  await roomBot.disconnect();

  assert.equal(reconnectionSetting, false);
  assert.equal(socketDisconnects, 1);
});

test('normal classification works again after a command reset', async () => {
  const botManager = manager();
  await botManager.resetState();
  botManager.config.baseConfig.excludeAdmins = true;
  const requests = [];
  const roomBot = fakeRoomBot(id => ({ id, privileges: 0 }), requests);

  const result = await classifySubscriberPatch(botManager, roomBot, ['42'], { attempts: 1 });

  assert.deepEqual(result.eligible, ['42']);
  assert.equal(botManager.eligibleUsers.has('42'), true);
  assert.equal(requests.length, 1);
});

test('a profile response from before reset cannot mutate the new session', async () => {
  const botManager = manager();
  let releaseRequest;
  let markRequestStarted;
  const requestStarted = new Promise(resolve => { markRequestStarted = resolve; });
  const requestGate = new Promise(resolve => { releaseRequest = resolve; });
  const roomBot = {
    connected: true,
    websocket: {
      emit: async () => {
        markRequestStarted();
        await requestGate;
        return { success: true, body: { 42: { success: true, body: { id: 42, privileges: 0 } } } };
      }
    }
  };

  const oldClassification = classifySubscriberPatch(botManager, roomBot, ['42'], { attempts: 1 });
  await requestStarted;
  await botManager.resetState();
  botManager.classificationState = 'classifying';
  botManager.classifyingUsers.add('new-session-user');
  releaseRequest();

  const result = await oldClassification;
  assert.equal(result.cancelled, true);
  assert.equal(botManager.eligibleUsers.has('42'), false);
  assert.equal(botManager.classifyingUsers.has('new-session-user'), true);
  assert.equal(botManager.classificationState, 'classifying');
});

test('magic activity is classified and queued after a command reset', async () => {
  const botManager = manager();
  await botManager.resetState();
  botManager.config.baseConfig.botType = 'magic';
  botManager.config.baseConfig.excludeAdmins = true;
  botManager.currentStep = 6;
  const requests = [];
  const roomBot = fakeRoomBot(id => ({ id, privileges: 0 }), requests);
  botManager.roomBots = [roomBot];
  botManager.classificationBots = [roomBot];

  await handleGroupMessage(botManager, { sourceSubscriberId: 77 }, roomBot);
  await waitUntil(() => botManager.channelUsers.has('77'));

  assert.equal(requests.length, 1);
  assert.equal(botManager.eligibleUsers.has('77'), true);
  assert.equal(botManager.channelUsers.has('77'), true);
  botManager.cancelClassification();
});

test('classification pool scales at the specified boundaries', () => {
  assert.equal(getClassificationBotTarget(1, 5000), 1);
  assert.equal(getClassificationBotTarget(1, 5001), 3);
  assert.equal(getClassificationBotTarget(2, 49999), 3);
  assert.equal(getClassificationBotTarget(2, 50000), 5);
  assert.equal(getClassificationBotTarget(4, 50000), 4);
  assert.equal(getClassificationBotTarget(6, 50000), 6);
  assert.equal(getClassificationBotTarget(72, 100000), 72);
  assert.equal(getClassificationBotTarget(73, 100000), 73);
  assert.equal(getClassificationBotTarget(75, 100000), 75);
  assert.equal(getClassificationBotTarget(100, 100000), 100);
  assert.equal(getClassificationBotTarget(145, 100000), 145);
});

test('room and classification pools have independent 145-bot capacity', async () => {
  assert.doesNotThrow(() => assertRoomAccountClassificationCapacity(145));
  assert.throws(() => assertRoomAccountClassificationCapacity(146), /145/);
  assert.doesNotThrow(() => assertRoomBotPoolCapacity(145));
  assert.throws(() => assertRoomBotPoolCapacity(146), /145/);

  const botManager = manager();
  botManager.roomBots = Array.from({ length: 145 }, () => ({ connected: true }));
  let disconnected = 0;
  botManager.classificationBots = Array.from({ length: 145 }, () => ({
    connected: true,
    disconnect: async () => { disconnected++; }
  }));
  await ensureClassificationBots(botManager, 100000);

  assert.equal(botManager.roomBots.length, 145);
  assert.equal(botManager.classificationBots.length, 145);
  assert.equal(disconnected, 0);
});

test('classification is completely bypassed when exclusion is disabled', async () => {
  const botManager = manager();
  botManager.config.baseConfig.excludeAdmins = false;
  botManager.roomBots = [{ connected: true }];
  botManager.enqueueCandidate(42);

  await ensureClassificationBots(botManager, 100000);

  assert.equal(botManager.classificationBots.length, 0);
  assert.deepEqual(botManager.getUsers(), ['42']);
  assert.equal(botManager.classificationQueue.length, 0);
});

test('classification connection is anonymous and identifies as web', () => {
  const { url, options } = buildAnonymousConnection({
    host: 'wss://v3.palringo.com',
    port: 443,
    token: 'must-not-leak',
    proxy: { enabled: false }
  });
  assert.equal(url, 'https://v3.palringo.com:443/');
  assert.deepEqual(options.query, { device: 'web' });
  assert.equal('auth' in options, false);
  assert.equal('token' in options, false);
});

test('classification connections use only their dedicated optional proxy', () => {
  const classificationConfig = {
    host: 'wss://v3.palringo.com',
    port: 443,
    proxy: { enabled: true, host: '127.0.0.2', port: 8080, protocol: 'http' }
  };
  const botManager = {
    config: {
      roomBotConfig: {
        proxy: { enabled: true, host: '127.0.0.1', port: 9000, protocol: 'http' }
      },
      classificationBotConfig: classificationConfig
    }
  };

  assert.equal(getClassificationConnectionConfig(botManager), classificationConfig);
  assert.ok(buildAnonymousConnection(classificationConfig).options.agent);

  const incompleteConfig = {
    host: 'wss://v3.palringo.com',
    port: 443,
    proxy: { enabled: true, host: '127.0.0.2', port: 0, protocol: 'http' }
  };
  assert.equal('agent' in buildAnonymousConnection(incompleteConfig).options, false);

  const legacyManager = { config: { roomBotConfig: botManager.config.roomBotConfig } };
  const legacyConfig = getClassificationConnectionConfig(legacyManager);
  assert.deepEqual(legacyConfig, {});
  assert.equal('agent' in buildAnonymousConnection(legacyConfig).options, false);
});

test('compact classifications survive an extended-profile failure', async () => {
  const botManager = manager();
  const requests = [];
  const classifier = {
    connected: true,
    requestProfiles: async (ids, extended) => {
      requests.push({ ids, extended });
      if (extended) { throw new Error('extended unavailable'); }
      return {
        code: 207,
        body: ids.map(id => ({ code: 200, body: Number(id) === 1 ? { id, privileges: 0 } : { id } }))
      };
    }
  };

  const result = await classifySubscriberPatch(botManager, classifier, ['1', '2'], { attempts: 1 });

  assert.deepEqual(result.eligible, ['1']);
  assert.deepEqual(result.unknown, ['2']);
  assert.deepEqual(requests.map(request => request.extended), [false, true]);
});

test('anonymous classifier enforces normal and magic start-to-start cooldowns', async () => {
  for (const [botType, minimum] of [['ad', 350], ['magic', 1000]]) {
    const botManager = manager();
    botManager.config.baseConfig.botType = botType;
    const starts = [];
    const classifier = new AnonymousClassificationBot(botManager, 0);
    classifier.connected = true;
    classifier.socket = {
      connected: true,
      emit: (_event, _payload, callback) => {
        starts.push(Date.now());
        callback({ code: 207, body: [] });
      }
    };
    await classifier.requestProfiles([1], false);
    await classifier.requestProfiles([2], true);
    assert.ok(starts[1] - starts[0] >= minimum - 10, `${botType} cooldown was too short`);
  }
});

test('a 429 pauses the whole manager classification pool for ten seconds', async () => {
  const botManager = manager();
  const classifier = new AnonymousClassificationBot(botManager, 0);
  classifier.connected = true;
  classifier.socket = {
    connected: true,
    emit: (_event, _payload, callback) => callback({ code: 429 })
  };
  const started = Date.now();
  await assert.rejects(classifier.requestProfiles([1], false), /429/);
  assert.ok(botManager.classificationRateLimitUntil >= started + 9900);
});

test('auto-run completion remains blocked by unknown users regardless of status races', () => {
  const botManager = manager();
  botManager.config.baseConfig.autoRun = true;
  botManager.classificationState = 'classifying';
  botManager.unknownUsers.add('42');
  assert.equal(botManager.hasPendingClassification(), true);
});

test('manual ignore decisions suppress the intended IDs without cancelling the generation', async () => {
  const botManager = manager();
  botManager.unknownUsers.add('1');
  botManager.classificationQueue.push('2');
  botManager.queuedUsers.add('2');
  const generation = botManager._classificationGeneration;

  await botManager.requestUnknownDecision();
  assert.equal(botManager.classificationState, 'decision-required');
  await botManager.handleIgnoreAllUnknownUsers();

  assert.equal(botManager._classificationGeneration, generation);
  assert.equal(botManager.ignoredUsers.has('1'), true);
  assert.equal(botManager.ignoredUsers.has('2'), true);
  assert.equal(botManager.classificationQueue.length, 0);
});

test('transactional ad batches wait for and dispose late successes', async () => {
  const botManager = manager();
  let call = 0;
  let disconnected = 0;
  botManager.connect = async () => {
    const index = call++;
    if (index === 0) { throw new Error('websocket error'); }
    await new Promise(resolve => setTimeout(resolve, 10));
    const bot = { disconnect: async () => { disconnected++; } };
    botManager.adBots.push(bot);
    return bot;
  };

  await assert.rejects(
    connectBotBatch(botManager, { botType: 'ad', count: 4, adBotIndex: 0 }),
    /websocket error/
  );

  assert.equal(call, 4);
  assert.equal(disconnected, 3);
  assert.deepEqual(botManager.adBots, []);
  assert.equal(botManager._connectionBatches.ad, null);
});

test('overlapping batches of the same account type are rejected', async () => {
  const botManager = manager();
  let releaseConnection;
  botManager.connect = async () => new Promise(resolve => {
    releaseConnection = () => resolve({ disconnect: async () => {} });
  });

  const firstBatch = connectBotBatch(botManager, { botType: 'ad', count: 1, adBotIndex: 0 });
  await waitUntil(() => typeof releaseConnection === 'function');
  await assert.rejects(
    connectBotBatch(botManager, { botType: 'ad', count: 1, adBotIndex: 0 }),
    /محاولة اتصال جارية/
  );
  releaseConnection();
  await firstBatch;
});

test('a room channel-list failure disconnects the registered account and starts cooldown', async () => {
  const botManager = manager();
  botManager.mainBot = { connected: true };
  let disconnects = 0;
  const roomBot = {
    connected: true,
    channel: { list: async () => { throw new Error('channel list failed'); } },
    disconnect: async () => { disconnects++; }
  };
  botManager.connect = async () => {
    botManager.roomBots.push(roomBot);
    return roomBot;
  };

  await assert.rejects(
    handleNormalRoomCommand('WE-room-token', botManager),
    /channel list failed/
  );

  assert.equal(disconnects, 1);
  assert.deepEqual(botManager.roomBots, []);
  assert.deepEqual(botManager.roomBotsTokens, []);
  assert.ok(botManager.roomConnectionCooldownUntil > Date.now());
  clearRoomConnectionCooldown(botManager);
});

test('ad rollback clears every account and emits an authoritative client reset', async () => {
  const botManager = manager();
  botManager.config.baseConfig.orderFrom = 1;
  botManager.config.baseConfig.autoRun = true;
  botManager.config.adBotConfig = [
    { token: 'WE-one', proxy: { host: 'one' } },
    { token: 'WE-two', proxy: { host: 'two' } }
  ];
  botManager.currentStep = 3;
  let disconnects = 0;
  botManager.adBots = Array.from({ length: 5 }, () => ({
    disconnect: async () => { disconnects++; }
  }));
  const events = [];
  botManager.socket = { connected: true, emit: (event, payload) => events.push({ event, payload }) };

  await rollbackAdAccountSetup(botManager, { notify: false });

  assert.equal(disconnects, 5);
  assert.deepEqual(botManager.adBots, []);
  assert.ok(botManager.config.adBotConfig.every(config => config.token === ''));
  assert.equal(botManager.config.baseConfig.autoRun, false);
  assert.equal(botManager.currentStep, 3);
  assert.ok(botManager.adConnectionCooldownUntil > Date.now());
  assert.deepEqual(events.find(item => item.event === 'ad:accounts:reset')?.payload, {
    activeBotsCount: 0,
    autoRun: false
  });
  clearAdConnectionCooldown(botManager);
});

test('manual ad connection failure is handled once and returns to account one', async () => {
  const botManager = manager();
  botManager.config.baseConfig.orderFrom = 1;
  botManager.config.baseConfig.instanceCount = 3;
  botManager.config.adBotConfig = [{ token: '', proxy: { host: 'proxy' } }];
  botManager.currentStep = 3;
  botManager.eligibleUsers.add('42');
  const messages = [];
  botManager.mainBot = {
    connected: true,
    isBusy: false,
    messaging: { sendPrivateMessage: async (_id, message) => { messages.push(message); } }
  };
  botManager.connect = async () => { throw new Error('Connection timeout after 15 seconds'); };
  botManager.socket = { connected: true, emit: () => {} };

  await handleAdAccountCommand(botManager, 'WE-failing-ad-token');

  assert.equal(messages.length, 1);
  assert.match(messages[0], /فشل في الاتصال/);
  assert.equal(messages[0].includes('Connection timeout after 15 seconds'), false);
  assert.equal(botManager.config.adBotConfig[0].token, '');
  assert.equal(botManager.currentStep, 3);
  assert.ok(botManager.adConnectionCooldownUntil > Date.now());
  clearAdConnectionCooldown(botManager);
});

test('ad connection cooldown rejects reuse and sends one expiry prompt', async () => {
  const botManager = manager();
  botManager.config.baseConfig.orderFrom = 1;
  const messages = [];
  botManager.mainBot = {
    connected: true,
    isBusy: false,
    messaging: { sendPrivateMessage: async (_id, message) => { messages.push(message); } }
  };

  startAdConnectionCooldown(botManager, { duration: 25 });
  assert.throws(() => assertAdConnectionCooldownComplete(botManager), /الانتظار/);
  await waitUntil(() => messages.length === 1);
  assert.doesNotThrow(() => assertAdConnectionCooldownComplete(botManager));
  assert.match(messages[0], /حساب الإعلان الأول/);
});

test('stop preserves ad style and creative while clearing runtime state', async () => {
  const botManager = manager();
  botManager.config.baseConfig.orderFrom = 1;
  botManager.currentStep = 7;
  botManager.messageCount = 3;
  botManager.messages = new Set(['one', 'two', 'three']);
  botManager.channelsAdsSent = 99;
  botManager.messagesDeliverdeTo.add('42');
  const messages = [];
  botManager.mainBot = {
    connected: true,
    isBusy: false,
    messaging: { sendPrivateMessage: async (_id, message) => { messages.push(message); } }
  };
  const events = [];
  botManager.socket = { connected: true, emit: (event, payload) => events.push({ event, payload }) };

  await handleStopCommand(botManager);

  assert.equal(botManager.messageCount, 3);
  assert.deepEqual(botManager.getMessages(), ['one', 'two', 'three']);
  assert.equal(botManager.channelsAdsSent, 0);
  assert.equal(botManager.messagesDeliverdeTo.size, 0);
  assert.equal(botManager.currentStep, 1);
  assert.ok(botManager.roomConnectionCooldownUntil > Date.now());
  assert.ok(botManager.adConnectionCooldownUntil > Date.now());
  assert.ok(events.some(item => item.event === 'state:clear'));
  assert.match(messages[0], /تم الاحتفاظ بنمط الإعلان/);
  clearRoomConnectionCooldown(botManager);
  clearAdConnectionCooldown(botManager);
});
