/* eslint-disable no-tabs */
import { sendPrivateMessage } from './messaging/sendPrivateMessage.js';
import { checkBotStep } from './steps/checkBotStep.js';

export const buildStateReport = (state, isActive) => {
  let usersLine = '';
  if (state.botType !== 'magic') {
    usersLine = `
		إجمالي المستخدمين : ${state.users || 0}`;
  }
  return `
		نوع البوت : ${state.botType === 'magic' ? 'السحري' : 'العادي'}${usersLine}
		عدد الاعلانات : ${state.adsSent || 0}
    حاله البوت : ${isActive ? 'يعمل' : 'متوقف'}`;
};

export const handleStateReport = async (botManager) => {
  try {
    const mainBot = botManager.getMainBot();
    const state = botManager.getState();
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
    const report = buildStateReport(state, isActive);
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
