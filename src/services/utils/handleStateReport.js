/* eslint-disable no-tabs */
import { sendPrivateMessage } from './messaging/sendPrivateMessage.js';
import { getStep } from './steps/getStep.js';

export const handleStateReport = async (botManager) => {
  try {
    const mainBot = botManager.getMainBot();
    const state = botManager.getState();
    const report = `حالة البوت:
		نوع البوت: ${state.botType === 'magic' ? 'سحري' : 'اعلان'}
		عدد بوتات الرووم المتصلة: ${state.roomBots}
		عدد بوتات الاعلانات المتصلة: ${state.adBots}
		عدد القنوات: ${state.channels}
		عدد المستخدمين: ${state.users}
		الرسائل: ${state.messages.join('\n')}
		الخطوة الحالية: ${getStep(state.currentStep, botManager)?.name || 'غير محددة'}
		الخطوة التالية: ${getStep(state.currentStep + 1, botManager)?.name || 'غير محددة'}
		عدد الاعلانات المرسلة: ${state.adsSent || 0}`;
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
