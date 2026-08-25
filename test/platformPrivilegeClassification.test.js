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
import { getLowRoomClassificationWorkerCount } from '../src/services/utils/roomBot/handlePrepareCommand.js';
import { sendUpdateEvent } from '../src/services/utils/updates/sendUpdateEvent.js';

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

  await Promise.all([
    handleGroupMessage(botManager, { sourceSubscriberId: 99 }, roomBot),
    handleGroupMessage(botManager, { sourceSubscriberId: 99 }, roomBot)
  ]);
  await handleGroupMessage(botManager, { sourceSubscriberId: 99 }, roomBot);

  assert.equal(requests.length, 1);
  assert.equal(botManager.excludedUsers.has('99'), true);
  assert.equal(botManager.channelUsers.has('99'), false);
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

test('socket updates safely ignore a missing or disconnected manager', async () => {
  assert.equal(await sendUpdateEvent(undefined, 'test', {}), false);
  assert.equal(await sendUpdateEvent({ socket: { connected: false } }, 'test', {}), false);
});

test('disconnect cleanup immediately and idempotently disconnects every bot', async () => {
  const botManager = manager();
  let disconnects = 0;
  const bot = () => ({ disconnect: async () => { disconnects++; } });
  botManager.mainBot = bot();
  botManager.roomBots = [bot()];
  botManager.adBots = [bot()];

  await Promise.all([
    botManager.clearForDisconnectState(),
    botManager.clearForDisconnectState()
  ]);

  assert.equal(disconnects, 3);
  assert.equal(botManager.roomBots.length, 0);
  assert.equal(botManager.adBots.length, 0);
});
