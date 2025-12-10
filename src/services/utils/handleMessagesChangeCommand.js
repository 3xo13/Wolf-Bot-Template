import { sendPrivateMessage } from './messaging/sendPrivateMessage.js';
import { checkBotStep } from './steps/checkBotStep.js';
import setStepState from './steps/setStepState.js';

const handleMessagesChangeCommand = async (botManager) => {
  try {
    const messageCount = botManager.getMessageCount();
    const mainBot = botManager.getMainBot();
    const userId = botManager.config.baseConfig.orderFrom;
    if (botManager.botType === 'ad') {
      if (checkBotStep(botManager, 'sending')) {
        await sendPrivateMessage(userId, 'أمر غير صالح, البوت قيد التشغيل', mainBot);
        return;
      }
    }
    if (botManager.botType === 'magic') {
      if (checkBotStep(botManager, 'messaging')) {
        await sendPrivateMessage(userId, 'أمر غير صالح, البوت قيد التشغيل', mainBot);
        return;
      }
    }
    if (messageCount < 1) {
      await sendPrivateMessage(userId, 'نمط الإعلان غير محدد', mainBot);
      return;
    }

    botManager.clearMessages();
    setStepState(botManager, 'adStyle');
    const singleMessageRes = 'أرسل رسالة الإعلان';
    const mutliMessageRes = 'أرسل رسالة الإعلان رقم ( 1 )';
    const userMessage = messageCount < 2 ? singleMessageRes : mutliMessageRes;
    await sendPrivateMessage(userId, userMessage, mainBot);
  } catch (error) {
    console.log('🚀 ~ handleMessagesChangeCommand ~ error:', error);
    throw error;
  }
};

export default handleMessagesChangeCommand;
