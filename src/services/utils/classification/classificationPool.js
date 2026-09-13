import AnonymousClassificationBot from '../../AnonymousClassificationBot.js';
import { classifySubscriberPatch } from './classifySubscribers.js';
import { queueEligibleActivities, queueEligibleActivity } from './magicQueue.js';

export const MAX_ROOM_BOTS = 145;
export const MAX_ROOMS_PER_ACCOUNT = MAX_ROOM_BOTS;
const CLASSIFICATION_CONNECT_CONCURRENCY = 6;
const CLASSIFICATION_CONNECT_ATTEMPTS = 3;
const CLASSIFICATION_CONNECT_RETRY_DELAYS_MS = [1000, 2000];

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export function assertRoomAccountClassificationCapacity (roomCount) {
  if (roomCount > MAX_ROOMS_PER_ACCOUNT) {
    throw new Error(`لا يمكن استخدام حساب رومات يحتوي على أكثر من ${MAX_ROOMS_PER_ACCOUNT} روم`);
  }
}

export function assertRoomBotPoolCapacity (roomBotCount) {
  if (roomBotCount > MAX_ROOMS_PER_ACCOUNT) {
    throw new Error(`لا يمكن تشغيل أكثر من ${MAX_ROOMS_PER_ACCOUNT} حساب روم`);
  }
}

export function getClassificationBotTarget (roomCount, userCount) {
  let lowRoomTarget = 0;
  if (roomCount < 3 && userCount > 5000) {
    lowRoomTarget = userCount < 50000 ? 3 : 5;
  }
  return Math.max(roomCount, lowRoomTarget);
}

async function trimClassificationBots (botManager, target) {
  if (botManager.classificationBots.length <= target) { return; }
  const removed = botManager.classificationBots.splice(target);
  await Promise.allSettled(removed.map(bot => bot.disconnect()));
  botManager.emitClassificationBotCount();
}

async function connectClassificationBot (botManager, bot, descriptor, generation) {
  let lastError;
  for (let attempt = 0; attempt < CLASSIFICATION_CONNECT_ATTEMPTS; attempt++) {
    if (botManager.isClassificationCancelled(generation)) { return { bot, cancelled: true }; }
    try {
      await bot.connect();
      if (botManager.isClassificationCancelled(generation)) {
        await bot.disconnect();
        return { bot, cancelled: true };
      }
      botManager.appCheckRegistry.registerConsumer(descriptor.recordId, bot);
      if (botManager.classificationWorkersActive) { startWorker(botManager, bot, generation); }
      return { bot, connected: true };
    } catch (error) {
      lastError = error;
      await bot.disconnect();
      if (botManager.isClassificationCancelled(generation)) { return { bot, cancelled: true }; }
      const retryDelay = CLASSIFICATION_CONNECT_RETRY_DELAYS_MS[attempt];
      if (!retryDelay) { break; }
      await wait(retryDelay);
    }
  }
  return { bot, error: lastError || new Error('Classification bot failed to connect') };
}

export async function connectClassificationBotsInWaves (botManager, bots, descriptor, generation) {
  const results = new Array(bots.length);
  let nextIndex = 0;
  const connectNext = async () => {
    while (nextIndex < bots.length && !botManager.isClassificationCancelled(generation)) {
      const index = nextIndex++;
      results[index] = await connectClassificationBot(botManager, bots[index], descriptor, generation);
    }
  };
  const workerCount = Math.min(CLASSIFICATION_CONNECT_CONCURRENCY, bots.length);
  await Promise.allSettled(Array.from({ length: workerCount }, connectNext));
  return results.filter(Boolean);
}

export async function ensureClassificationBots (botManager, userCount = botManager.seenUsers.size) {
  if (!botManager.config.baseConfig.excludeAdmins) { return []; }
  await botManager.waitForClassificationAppCheckPrefetch();
  const appCheck = botManager.appCheckRegistry.get('classification');
  if (!appCheck?.token || appCheck.expiresAt <= Date.now()) {
    const error = new Error('رمز التحقق الخاص بحسابات التصنيف غير جاهز. أعد محاولة التحقق أولاً.');
    error.code = 'APP_CHECK_REQUIRED';
    throw error;
  }
  const descriptor = botManager.getConnectionDescriptor('classification');
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
      new AnonymousClassificationBot(botManager, botManager.classificationBots.length + index, descriptor.config)
    );
    botManager.classificationBots.push(...newBots);
    const results = await connectClassificationBotsInWaves(botManager, newBots, descriptor, generation);
    const failedBots = new Set(results.filter(result => !result.connected).map(result => result.bot));
    if (failedBots.size) {
      botManager.classificationBots = botManager.classificationBots.filter(bot => !failedBots.has(bot));
      const firstFailure = results.find(result => result.error)?.error;
      console.warn(`Anonymous classification pool connected ${newBots.length - failedBots.size}/${newBots.length} new bots${firstFailure ? `; first failure: ${firstFailure.message}` : ''}`);
    }
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
      if (botManager.isAppCheckPaused()) {
        await botManager.waitForAppCheckResume();
        continue;
      }
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
  if (botManager.isAppCheckPaused()) {
    botManager.emitClassificationStatus('classifying');
    botManager.signalRecipientChange();
    return true;
  }
  await ensureClassificationBots(botManager, botManager.seenUsers.size);
  startClassificationWorkers(botManager, { persistent: true });
  botManager.emitClassificationStatus(botManager.classificationPaused ? 'decision-required' : 'classifying');
  botManager.signalRecipientChange();
  return true;
}

export async function processMagicClassificationResult (botManager, result) {
  return handleResult(botManager, result);
}
