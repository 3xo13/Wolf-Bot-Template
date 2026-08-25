import { classifySubscriberPatch } from './classifySubscribers.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';

const RETRY_INTERVAL = 10000;

async function report (botManager, prefix) {
  const { eligible, excluded, unknown } = botManager.getClassificationCounts();
  botManager.emitClassificationStatus();
  const mainBot = botManager.getMainBot();
  if (mainBot?.connected) {
    await sendPrivateMessage(
      botManager.config.baseConfig.orderFrom,
      `${prefix}\nالمؤهلون: ${eligible}\nالمستثنون: ${excluded}\nغير المعروفين: ${unknown}`,
      mainBot,
      mainBot
    );
  }
}

function healthyRoomBot (botManager) {
  return botManager.getRoomBots().find(bot => bot.connected && bot.currentSubscriber);
}

export function startSlowUnknownRetry (botManager) {
  if (botManager.slowRetryPromise || botManager.ignoreUnknownUsers) { return botManager.slowRetryPromise; }
  const generation = botManager._classificationGeneration;
  botManager.classificationState = 'retrying';
  botManager.emitClassificationStatus('retrying');

  const task = (async () => {
    while (botManager.unknownUsers.size && !botManager.ignoreUnknownUsers && !botManager.isClassificationCancelled(generation)) {
      const bot = healthyRoomBot(botManager);
      if (bot) {
        const patch = [...botManager.unknownUsers].slice(0, 50);
        botManager.classificationInFlight++;
        try {
          await classifySubscriberPatch(botManager, bot, patch, { attempts: 1 });
        } finally {
          botManager.classificationInFlight--;
        }
      }
      if (!botManager.unknownUsers.size || botManager.ignoreUnknownUsers || botManager.isClassificationCancelled(generation)) { break; }
      await new Promise(resolve => {
        botManager.slowRetryWake = resolve;
        botManager.slowRetryTimer = setTimeout(resolve, RETRY_INTERVAL);
      });
      botManager.slowRetryTimer = null;
      botManager.slowRetryWake = null;
    }

    if (!botManager.isClassificationCancelled(generation)) {
      botManager.classificationState = 'idle';
      await report(botManager, botManager.ignoreUnknownUsers ? 'تم تجاهل المستخدمين غير المعروفين.' : 'اكتمل فحص المستخدمين.');
      await botManager.clearRoomBots();
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
    await report(botManager, 'لا يوجد مستخدمون بحاجة لإعادة الفحص.');
    return;
  }
  botManager.ignoreUnknownUsers = false;
  await report(botManager, 'بدأت إعادة فحص المستخدمين: دفعة من 50 كل 10 ثوانٍ.');
  startSlowUnknownRetry(botManager);
}

export async function handleIgnoreUnknownUsers (botManager) {
  botManager.ignoreUnknownUsers = true;
  botManager._classificationGeneration++;
  botManager.unknownUsers.clear();
  if (botManager.slowRetryTimer) { clearTimeout(botManager.slowRetryTimer); }
  if (botManager.slowRetryWake) { botManager.slowRetryWake(); }
  botManager.slowRetryTimer = null;
  botManager.slowRetryWake = null;
  botManager.classificationState = 'idle';
  botManager.emitClassificationStatus('idle');
  botManager.signalRecipientChange();
  await report(botManager, 'تم تجاهل المستخدمين غير المعروفين لهذه الجلسة.');
  if (botManager.getBotType() === 'ad') { await botManager.clearRoomBots(); }
}

export async function reportUnknownDecision (botManager) {
  botManager.classificationState = 'decision-required';
  await report(botManager, 'تعذر تصنيف بعض المستخدمين. أرسل «اعادة فحص المستخدمين» للمحاولة البطيئة أو «تجاهل المستخدمين» لتخطيهم.');
}

export async function reportAutoClassification (botManager) {
  await report(botManager, 'بدأت الحملة وسيعاد فحص المستخدمين غير المعروفين تلقائياً.');
}
