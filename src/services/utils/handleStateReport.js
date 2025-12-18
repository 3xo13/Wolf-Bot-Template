/* eslint-disable no-tabs */
import { sendPrivateMessage } from './messaging/sendPrivateMessage.js';
import { checkBotStep } from './steps/checkBotStep.js';

export const handleStateReport = async (botManager) => {
  try {
    const mainBot = botManager.getMainBot();
    const state = botManager.getState();
    const channelsLength = botManager.getChannels().length;
    let isActive = false;
    if (botManager.botType === 'ad') {
      if (checkBotStep(botManager, 'sending')) {
        isActive = true;
      }
    }
    if (botManager.botType === 'magic') {
      if (checkBotStep(botManager, 'messaging')) {
        isActive = true;
      }
    }
    // 	إجمالي الأعضاء : ${state.users}
    const report = ` 
		نوع البوت : ${state.botType === 'magic' ? 'السحري' : 'العادي'}
		عدد الاعلانات : ${state.adsSent + 1 || 0}
    حاله البوت : ${isActive ? 'يعمل' : 'متوقف'}`;
    await sendPrivateMessage(
      botManager.config.baseConfig.orderFrom,
      report,
      mainBot, mainBot
    );
  } catch (error) {
    console.log('🚀 ~ handleStateReport ~ error:', error);
    throw error;
  }
};
