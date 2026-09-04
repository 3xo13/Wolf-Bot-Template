import { magicBotSteps } from '../../constants/magicBotSteps.js';
import { updateEvents } from '../../constants/updateEvents.js';
import { sendUpdateEvent } from '../../updates/sendUpdateEvent.js';
import { sendPrivateMessage } from '../../messaging/sendPrivateMessage.js';
import setStepState from '../../steps/setStepState.js';
import { checkBotStep } from '../../steps/checkBotStep.js';
import handleBotStepReplay from '../../steps/handleBotStepReplay.js';
import { ensureClassificationBots, startClassificationWorkers } from '../../classification/classificationPool.js';

export const handleAdRunCommand = async (botManager) => {
  try {
    const mainBot = botManager.getMainBot();
    const messagesLength = botManager.getMessages().length;
    const messagesCount = botManager.getMessageCount();
    if (!checkBotStep(botManager, 'message') || messagesCount !== messagesLength) {
      await handleBotStepReplay(botManager);
      return;
    }
    if (!botManager.getAdBots().length) {
      throw new Error('لا يوجد بوتات إعلانات متصلة');
    }
    if (!botManager.getMessages().length) {
      throw new Error('لا يوجد رسائل في القائمة');
    }
    if (botManager.config.baseConfig.excludeAdmins) {
      await ensureClassificationBots(botManager);
      if (!botManager.getClassificationBots().length) {
        throw new Error('تعذر إنشاء حسابات التصنيف');
      }
      startClassificationWorkers(botManager, { persistent: true });
    }
    setStepState(botManager, 'messaging');
    await sendUpdateEvent(botManager, updateEvents.ad.start, { isOn: true });
    await sendPrivateMessage(botManager.config.baseConfig.orderFrom, `${magicBotSteps.messaging.description}
    ${magicBotSteps.messaging.nextStepMessage}`, mainBot, mainBot);
  } catch (error) {
    console.log('🚀 ~ handleAdRunCommand ~ error:', error);
    throw error;
  }
};
