import AnonymousClassificationBot from '../../AnonymousClassificationBot.js';
import { classifySubscriberPatch } from './classifySubscribers.js';
import { queueEligibleActivities, queueEligibleActivity } from './magicQueue.js';

export const MAX_ROOM_AND_CLASSIFICATION_BOTS = 145;
export const MAX_ROOMS_PER_ACCOUNT = MAX_ROOM_AND_CLASSIFICATION_BOTS - 10;

export function assertRoomAccountClassificationCapacity (roomCount) {
  if (roomCount > MAX_ROOMS_PER_ACCOUNT) {
    throw new Error(`لا يمكن استخدام حساب رومات يحتوي على أكثر من ${MAX_ROOMS_PER_ACCOUNT} روم، لضمان توفر 10 حسابات على الأقل للتصنيف`);
  }
}

export function assertRoomBotPoolCapacity (roomBotCount) {
  if (roomBotCount > MAX_ROOMS_PER_ACCOUNT) {
    throw new Error(`لا يمكن تشغيل أكثر من ${MAX_ROOMS_PER_ACCOUNT} حساب روم، لضمان توفر 10 حسابات على الأقل للتصنيف`);
  }
}

export function getClassificationBotTarget (roomCount, userCount) {
  let lowRoomTarget = 0;
  if (roomCount < 3 && userCount > 5000) {
    lowRoomTarget = userCount < 50000 ? 3 : 5;
  }
  const desiredTarget = Math.max(roomCount, lowRoomTarget);
  const availableSlots = Math.max(0, MAX_ROOM_AND_CLASSIFICATION_BOTS - roomCount);
  return Math.min(desiredTarget, availableSlots);
}

async function trimClassificationBots (botManager, target) {
  if (botManager.classificationBots.length <= target) { return; }
  const removed = botManager.classificationBots.splice(target);
  await Promise.allSettled(removed.map(bot => bot.disconnect()));
  botManager.emitClassificationBotCount();
}

export async function reserveClassificationCapacityForRoomBots (botManager, futureRoomBotCount) {
  assertRoomBotPoolCapacity(futureRoomBotCount);
  if (!botManager.config.baseConfig.excludeAdmins) { return; }
  await trimClassificationBots(
    botManager,
    getClassificationBotTarget(futureRoomBotCount, botManager.seenUsers.size)
  );
}

export async function ensureClassificationBots (botManager, userCount = botManager.seenUsers.size) {
  if (!botManager.config.baseConfig.excludeAdmins) { return []; }
  const target = getClassificationBotTarget(botManager.getRoomBots().length, userCount);
  await trimClassificationBots(botManager, target);
  if (botManager.classificationBots.length >= target) { return botManager.classificationBots; }
  if (botManager.classificationBotConnectPromise) {
    await botManager.classificationBotConnectPromise;
    return ensureClassificationBots(botManager, userCount);
  }
  const generation = botManager._classificationGeneration;
  const task = (async () => {
    const missing = Math.max(0, target - botManager.classificationBots.length);
    const newBots = Array.from({ length: missing }, (_, index) =>
      new AnonymousClassificationBot(botManager, botManager.classificationBots.length + index)
    );
    botManager.classificationBots.push(...newBots);
    await Promise.allSettled(newBots.map(async bot => {
      try {
        await bot.connect();
        if (botManager.classificationWorkersActive && !botManager.isClassificationCancelled(generation)) {
          startWorker(botManager, bot, generation);
        }
      } catch (error) {
        console.warn('Anonymous classification bot failed to connect:', error.message);
        botManager.classificationBots = botManager.classificationBots.filter(item => item !== bot);
        await bot.disconnect();
      }
    }));
    botManager.emitClassificationBotCount();
  })();
  const trackedTask = task.finally(() => {
    if (botManager.classificationBotConnectPromise === trackedTask) {
      botManager.classificationBotConnectPromise = null;
    }
  });
  botManager.classificationBotConnectPromise = trackedTask;
  await trackedTask;
  return botManager.classificationBots;
}

async function handleResult (botManager, result) {
  if (botManager.getBotType() !== 'magic') { return; }
  const eligibleActivities = result.eligible.filter(id =>
    botManager.pendingMagicActivities.has(id) && !botManager.ignoredUsers.has(id)
  );
  if (eligibleActivities.length) {
    await queueEligibleActivities(botManager, eligibleActivities);
  }
  result.excluded.forEach(id => botManager.pendingMagicActivities.delete(id));
}

async function maybeHandleFailure (botManager, result, generation) {
  if (!result.unknown.length || botManager.isClassificationCancelled(generation)) { return; }
  if (botManager.config.baseConfig.autoRun) {
    botManager.startSlowUnknownRetry();
    return;
  }
  botManager.classificationPaused = true;
  botManager.signalRecipientChange();
}

async function workerLoop (botManager, bot, generation) {
  try {
    while (!botManager.isClassificationCancelled(generation) && botManager.classificationWorkersActive) {
      if (!bot.connected || bot.isWorking || botManager.classificationPaused) {
        await botManager.waitForRecipientChange(250);
        continue;
      }
      const persistent = botManager.classificationWorkersPersistent;
      const allowPartial = persistent || botManager.classificationProducers <= 0;
      const patch = botManager.takeClassificationPatch(50, allowPartial);
      if (!patch.length) {
        if (!persistent && botManager.classificationProducers <= 0) {
          if (!botManager.unknownUsers.size) { botManager.emitClassificationStatus('idle'); }
          return;
        }
        await botManager.waitForRecipientChange(100);
        continue;
      }

      bot.isWorking = true;
      botManager.classificationInFlight++;
      try {
        const result = await classifySubscriberPatch(botManager, bot, patch);
        if (!result.cancelled) {
          await handleResult(botManager, result);
          await maybeHandleFailure(botManager, result, generation);
        }
      } finally {
        bot.isWorking = false;
        if (!botManager.isClassificationCancelled(generation)) {
          botManager.classificationInFlight = Math.max(0, botManager.classificationInFlight - 1);
          if (botManager.classificationPaused && botManager.classificationInFlight === 0) {
            await botManager.requestUnknownDecision();
          } else if (!botManager.classificationPaused && botManager.classificationInFlight === 0 &&
            botManager.classificationQueueIndex >= botManager.classificationQueue.length &&
            !botManager.unknownUsers.size) {
            botManager.emitClassificationStatus('idle');
          }
        }
        botManager.signalRecipientChange();
      }
    }
  } finally {
    botManager.signalRecipientChange();
  }
}

function startWorker (botManager, bot, generation) {
  if (botManager.classificationWorkerTasks.has(bot)) { return; }
  const task = workerLoop(botManager, bot, generation);
  const trackedTask = task.catch(error => {
    console.error('Classification worker failed:', error);
  }).finally(() => {
    if (botManager.classificationWorkerTasks.get(bot) === trackedTask) {
      botManager.classificationWorkerTasks.delete(bot);
    }
  });
  botManager.classificationWorkerTasks.set(bot, trackedTask);
}

export function startClassificationWorkers (botManager, { persistent = false } = {}) {
  if (!botManager.config.baseConfig.excludeAdmins) { return; }
  botManager.classificationWorkersActive = true;
  botManager.classificationWorkersPersistent = persistent;
  const generation = botManager._classificationGeneration;
  botManager.classificationBots.forEach(bot => startWorker(botManager, bot, generation));
  botManager.signalRecipientChange();
}

export async function waitForClassificationWorkers (botManager, generation) {
  while (!botManager.isClassificationCancelled(generation)) {
    const queueEmpty = botManager.classificationQueueIndex >= botManager.classificationQueue.length;
    if (botManager.classificationProducers <= 0 && queueEmpty && botManager.classificationInFlight === 0 && !botManager.classificationPaused) { return; }
    await botManager.waitForRecipientChange(100);
  }
}

export async function enqueueMagicCandidate (botManager, userId) {
  const id = String(userId);
  if (botManager.ignoredUsers.has(id) || botManager.excludedUsers.has(id)) { return false; }
  botManager.pendingMagicActivities.add(id);
  if (botManager.eligibleUsers.has(id)) {
    await queueEligibleActivity(botManager, id);
    return false;
  }
  if (botManager.queuedUsers.has(id) || botManager.classifyingUsers.has(id) || botManager.unknownUsers.has(id)) {
    return false;
  }
  if (!botManager.seenUsers.has(id)) { botManager.seenUsers.add(id); }
  botManager.classificationQueue.push(id);
  botManager.queuedUsers.add(id);
  await ensureClassificationBots(botManager, botManager.seenUsers.size);
  startClassificationWorkers(botManager, { persistent: true });
  botManager.emitClassificationStatus(botManager.classificationPaused ? 'decision-required' : 'classifying');
  botManager.signalRecipientChange();
  return true;
}

export async function processMagicClassificationResult (botManager, result) {
  return handleResult(botManager, result);
}
