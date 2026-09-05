import { connectBotBatch, CONNECTION_BATCH_BUSY } from '../connections/connectBotBatch.js';
import { userMessages } from '../constants/userMessages.js';
import { updateEvents } from '../constants/updateEvents.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';
import setStepState from '../steps/setStepState.js';
import { sendUpdateEvent } from '../updates/sendUpdateEvent.js';
import { startAdConnectionCooldown } from '../roomBot/roomConnectionCooldown.js';

export async function rollbackAdAccountSetup (botManager, { notify = true } = {}) {
  botManager.invalidateConnectionAttempts('ad');
  await botManager.clearAdBots();
  botManager.clearAdBotsTokens();
  botManager.adBotsQueue = [];
  botManager.config.baseConfig.autoRun = false;
  setStepState(botManager, botManager.getBotType() === 'ad' ? 'members' : 'room');
  startAdConnectionCooldown(botManager);
  await sendUpdateEvent(botManager, updateEvents.ad.accountsReset, {
    activeBotsCount: 0,
    autoRun: false
  });
  if (notify) {
    const mainBot = botManager.getMainBot();
    await sendPrivateMessage(
      botManager.config.baseConfig.orderFrom,
      `❌ فشل في الاتصال بأحد حسابات الإعلانات. يرجى التحقق من التوكن أو تغيير الحساب.
${userMessages.adConnectionCooldownStarted}`,
      mainBot,
      mainBot
    );
  }
}

export async function connectAdAccountBatch (botManager, adBotIndex) {
  try {
    await connectBotBatch(botManager, {
      botType: 'ad',
      count: botManager.config.baseConfig.instanceCount,
      adBotIndex
    });
    return true;
  } catch (error) {
    if (error.code === CONNECTION_BATCH_BUSY) { throw error; }
    if (botManager.isReseting) { return false; }
    await rollbackAdAccountSetup(botManager);
    return false;
  }
}
