import { classifySubscriberPatch } from './classifySubscribers.js';
import { processMagicClassificationResult, startClassificationWorkers } from './classificationPool.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';

const RETRY_INTERVAL = 10000;

async function report (botManager, prefix) {
  const { eligible, excluded, unknown } = botManager.getClassificationCounts();
  botManager.emitClassificationStatus();
  const mainBot = botManager.getMainBot();
  if (mainBot?.connected) {
    try {
      await sendPrivateMessage(
        botManager.config.baseConfig.orderFrom,
        `${prefix}\nالمؤهلون: ${eligible}\nالمستثنون: ${excluded}\nغير المعروفين: ${unknown}`,
        mainBot,
        mainBot
      );
    } catch (error) {
      console.warn('Failed to send classification report:', error.message);
    }
  }
}

function wakeRetry (botManager) {
  if (botManager.slowRetryTimer) { clearTimeout(botManager.slowRetryTimer); }
  if (botManager.slowRetryWake) { botManager.slowRetryWake(); }
  botManager.slowRetryTimer = null;
  botManager.slowRetryWake = null;
}

function waitForRetry (botManager) {
  return new Promise(resolve => {
    const finish = () => {
      if (botManager.slowRetryTimer) { clearTimeout(botManager.slowRetryTimer); }
      botManager.slowRetryTimer = null;
      botManager.slowRetryWake = null;
      resolve();
    };
    botManager.slowRetryWake = finish;
    botManager.slowRetryTimer = setTimeout(finish, RETRY_INTERVAL);
  });
}

function freeClassifier (botManager) {
  return botManager.getClassificationBots().find(bot => bot.connected && !bot.isWorking);
}

export function startSlowUnknownRetry (botManager) {
  if (botManager.slowRetryPromise || !botManager.config.baseConfig.autoRun) {
    return botManager.slowRetryPromise;
  }
  const generation = botManager._classificationGeneration;
  botManager.emitClassificationStatus('retrying');

  const task = (async () => {
    while (botManager.unknownUsers.size && !botManager.isClassificationCancelled(generation)) {
      await waitForRetry(botManager);
      if (!botManager.unknownUsers.size || botManager.isClassificationCancelled(generation)) { break; }
      const classifier = freeClassifier(botManager);
      if (classifier) {
        const patch = [...botManager.unknownUsers]
          .filter(id => !botManager.ignoredUsers.has(id))
          .slice(0, 50);
        if (patch.length) {
          classifier.isWorking = true;
          botManager.classificationInFlight++;
          try {
            const result = await classifySubscriberPatch(botManager, classifier, patch, { attempts: 1 });
            if (!result.cancelled) { await processMagicClassificationResult(botManager, result); }
          } finally {
            classifier.isWorking = false;
            if (!botManager.isClassificationCancelled(generation)) {
              botManager.classificationInFlight = Math.max(0, botManager.classificationInFlight - 1);
            }
            botManager.signalRecipientChange();
          }
        }
      }
    }

    if (!botManager.isClassificationCancelled(generation)) {
      botManager.emitClassificationStatus('idle');
      await report(botManager, 'اكتمل فحص الأعضاء.');
      if (botManager.getBotType() === 'ad' && !botManager.hasPendingClassification()) {
        await botManager.clearClassificationBots();
      }
    }
  })();
  const trackedTask = task.finally(() => {
    if (botManager.slowRetryPromise === trackedTask) { botManager.slowRetryPromise = null; }
    botManager.signalRecipientChange();
  });
  botManager.slowRetryPromise = trackedTask;
  return trackedTask;
}

export async function handleRetryUnknownUsers (botManager) {
  if (!botManager.unknownUsers.size) {
    await report(botManager, 'لا يوجد أعضاء بحاجة لإعادة الفحص.');
    return;
  }
  const failed = [...botManager.unknownUsers].filter(id => !botManager.ignoredUsers.has(id));
  failed.forEach(id => botManager.unknownUsers.delete(id));
  botManager.classificationPaused = false;
  botManager.classificationDecisionReported = false;
  botManager.prependClassificationCandidates(failed);
  botManager.emitClassificationStatus('retrying');
  startClassificationWorkers(botManager, { persistent: botManager.getBotType() === 'magic' });
  await report(botManager, 'بدأت إعادة فحص الأعضاء.');
}

export async function handleIgnoreUnknownUsers (botManager) {
  const failed = [...botManager.unknownUsers];
  failed.forEach(id => {
    botManager.ignoredUsers.add(id);
    botManager.unknownUsers.delete(id);
    botManager.pendingMagicActivities.delete(id);
  });
  botManager.classificationPaused = false;
  botManager.classificationDecisionReported = false;
  wakeRetry(botManager);
  const hasQueued = botManager.classificationQueueIndex < botManager.classificationQueue.length;
  botManager.emitClassificationStatus(hasQueued || botManager.classificationInFlight ? 'classifying' : 'idle');
  startClassificationWorkers(botManager, { persistent: botManager.getBotType() === 'magic' });
  botManager.signalRecipientChange();
  await report(botManager, 'تم تجاهل الأعضاء غير المعروفين لهذه الجلسة، وسيستمر فحص الأعضاء الجدد.');
}

export async function handleIgnoreAllUnknownUsers (botManager) {
  const suppressed = new Set([
    ...botManager.unknownUsers,
    ...botManager.classificationQueue.slice(botManager.classificationQueueIndex),
    ...botManager.classifyingUsers
  ]);
  suppressed.forEach(id => {
    botManager.ignoredUsers.add(String(id));
    botManager.pendingMagicActivities.delete(String(id));
  });
  botManager.unknownUsers.clear();
  botManager.clearPendingClassificationQueue();
  botManager.classificationPaused = false;
  botManager.classificationDecisionReported = false;
  wakeRetry(botManager);
  botManager.emitClassificationStatus('idle');
  botManager.signalRecipientChange();
  await report(botManager, 'تم تجاهل الأعضاء المتعذر فحصهم وكل الأعضاء المنتظرين. سيُفحص أي عضو جديد لاحقاً.');
}

export async function reportUnknownDecision (botManager) {
  if (botManager.classificationDecisionReported || !botManager.unknownUsers.size) { return; }
  botManager.classificationDecisionReported = true;
  botManager.emitClassificationStatus('decision-required');
  await report(
    botManager,
    'تعذر تصنيف بعض الأعضاء. أرسل «اعادة فحص الاعضاء» للمحاولة مجدداً، أو «تجاهل الاعضاء» لتجاهل المتعذر فحصهم، أو «تجاهل جميع الاعضاء» لتجاهلهم وكل المنتظرين.'
  );
}

export async function reportAutoClassification (botManager) {
  await report(botManager, 'بدأت الحملة وستتم إعادة فحص الأعضاء غير المعروفين تلقائياً.');
}
