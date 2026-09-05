import { rollbackAdAccountSetup } from './adAccountConnection.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';

export const AD_CAMPAIGN_OUTAGE_TIMEOUT_MS = 5 * 60 * 1000;

export function getConnectedAdBots (botManager, { availableOnly = false } = {}) {
  return botManager.getAdBots().filter(bot => bot?.connected && (
    !availableOnly || (!bot.isWorking && !bot.isBusy)
  ));
}

function clearOutageTimer (botManager) {
  if (botManager._adCampaignOutageTimer) {
    clearTimeout(botManager._adCampaignOutageTimer);
  }
  botManager._adCampaignOutageTimer = null;
  botManager._adCampaignOfflineSince = 0;
}

function signalAvailabilityChange (botManager) {
  for (const resolve of botManager._adAvailabilityWaiters || []) { resolve(); }
  botManager._adAvailabilityWaiters?.clear();
}

function detachAvailabilityListeners (botManager) {
  for (const [bot, listener] of botManager._adCampaignBotListeners || []) {
    bot.off?.('disconnected', listener);
    bot.off?.('resume', listener);
  }
  botManager._adCampaignBotListeners?.clear();
}

function getCampaignAdsSent (botManager) {
  return botManager.getBotType() === 'magic'
    ? botManager.channelsAdsSent
    : botManager.getLastUserIndex();
}

async function abortForOutage (botManager, generation) {
  if (!botManager._adCampaignActive || generation !== botManager._campaignGeneration ||
    getConnectedAdBots(botManager).length) {
    return false;
  }

  const adsSent = getCampaignAdsSent(botManager);
  botManager.isReseting = true;
  try {
    cancelAdCampaignMonitor(botManager, { generation });
    await rollbackAdAccountSetup(botManager, { notify: false });

    const mainBot = botManager.getMainBot();
    if (mainBot?.connected && !botManager._destroyed) {
      await sendPrivateMessage(
        botManager.config.baseConfig.orderFrom,
        `توقفت الحملة لأن جميع حسابات الإعلانات ظلت غير متصلة لمدة 5 دقائق.
عدد الإعلانات المرسلة قبل الانقطاع: ${adsSent}
تم حفظ تقدم الحملة والأعضاء الذين تم إرسال الإعلان إليهم.
يرجى الانتظار حتى يصلك إشعار إمكانية إضافة حساب الإعلان الأول من جديد.`,
        mainBot,
        mainBot
      );
    }
    return true;
  } finally {
    if (!botManager._destroyed) { botManager.isReseting = false; }
  }
}

function refreshAvailability (botManager, generation) {
  if (!botManager._adCampaignActive || generation !== botManager._campaignGeneration) { return; }
  signalAvailabilityChange(botManager);
  if (getConnectedAdBots(botManager).length) {
    clearOutageTimer(botManager);
    return;
  }
  if (botManager._adCampaignOutageTimer) { return; }

  botManager._adCampaignOfflineSince = Date.now();
  const timeout = Number(botManager._adCampaignOutageTimeoutMs) || AD_CAMPAIGN_OUTAGE_TIMEOUT_MS;
  botManager._adCampaignOutageTimer = setTimeout(() => {
    botManager._adCampaignOutageTimer = null;
    botManager._adCampaignAbortPromise = abortForOutage(botManager, generation)
      .catch(error => console.error('Failed to abort campaign after ad-bot outage:', error))
      .finally(() => { botManager._adCampaignAbortPromise = null; });
  }, timeout);
  botManager._adCampaignOutageTimer.unref?.();
}

export function startAdCampaignMonitor (botManager) {
  cancelAdCampaignMonitor(botManager);
  const generation = botManager._campaignGeneration;
  botManager._adCampaignActive = true;
  for (const bot of botManager.getAdBots()) {
    const listener = () => refreshAvailability(botManager, generation);
    bot.on?.('disconnected', listener);
    bot.on?.('resume', listener);
    botManager._adCampaignBotListeners.set(bot, listener);
  }
  refreshAvailability(botManager, generation);
  return generation;
}

export function cancelAdCampaignMonitor (botManager, { generation } = {}) {
  if (generation !== undefined && generation !== botManager._campaignGeneration) { return false; }
  botManager._campaignGeneration++;
  botManager._adCampaignActive = false;
  clearOutageTimer(botManager);
  detachAvailabilityListeners(botManager);
  signalAvailabilityChange(botManager);
  return true;
}

export function isAdCampaignActive (botManager, generation) {
  return botManager._adCampaignActive && generation === botManager._campaignGeneration &&
    !botManager.isReseting && !botManager._destroyed;
}

export async function waitForConnectedAdBot (botManager, generation) {
  while (isAdCampaignActive(botManager, generation)) {
    if (getConnectedAdBots(botManager).length) { return true; }
    await new Promise(resolve => botManager._adAvailabilityWaiters.add(resolve));
  }
  return false;
}
