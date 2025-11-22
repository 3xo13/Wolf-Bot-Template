import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';
import { handleAdBotAutoRun } from './handleAdBotAutoRun.js';
import { handleMagicBotAutoRun } from './handleMagicBotAutoRun.js';

export const handleAutoRun = async (botManager) => {
  const botType = botManager.getBotType();
  const mainBot = botManager.getMainBot();
  try {
    switch (botType) {
      case 'ad':
        handleAdBotAutoRun(botManager);
        break;
      case 'magic':
        handleMagicBotAutoRun(botManager);
        break;
      default:
        console.warn(`⚠️ Unknown bot type: ${botType}`);
        throw new Error(`Unknown bot type: ${botType}`);
    }
  } catch (error) {
    console.log('🚀 ~ handleAutoRun ~ error:', error);
    await sendPrivateMessage(botManager.config.baseConfig.orderFrom, error.message, mainBot);
  }
};
