import { updateEvents } from '../constants/updateEvents.js';
import { userMessages } from '../constants/userMessages.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';
import { checkBotStep } from '../steps/checkBotStep.js';
import { sendUpdateEvent } from '../updates/sendUpdateEvent.js';

export const handleStopCommand = async (botManager) => {
  try {
    const mainBot = botManager.getMainBot();
    if (checkBotStep(botManager, 'sending') || checkBotStep(botManager, 'messaging')) {
      await botManager.clearState();
      await sendUpdateEvent(botManager, updateEvents.state.clear, {});
      await sendPrivateMessage(
        botManager.config.baseConfig.orderFrom,
        userMessages.stateCleared,
        mainBot
      );
    } else {
      await sendPrivateMessage(
        botManager.config.baseConfig.orderFrom,
        userMessages.adsNotRunning,
        mainBot, mainBot
      );
    }
  } catch (error) {
    console.log('🚀 ~ handleStopCommand ~ error:', error);
    throw error;
  }
};
