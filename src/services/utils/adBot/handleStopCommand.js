import { updateEvents } from '../constants/updateEvents.js';
import { userMessages } from '../constants/userMessages.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';
import { checkBotStep } from '../steps/checkBotStep.js';
import handleBotStepReplay from '../steps/handleBotStepReplay.js';
import { sendUpdateEvent } from '../updates/sendUpdateEvent.js';

export const handleStopCommand = async (botManager) => {
  try {
    const mainBot = botManager.getMainBot();
    console.log('🚀 ~ handleStopCommand ~ botManager.botType:', botManager.botType);
    if (botManager.botType === 'ad') {
      if (checkBotStep(botManager, 'sending')) {
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
          'البوت لا يعمل حالياً.',
          mainBot
        );
      }
    }
    if (botManager.botType === 'magic') {
      if (checkBotStep(botManager, 'messaging')) {
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
          'البوت لا يعمل حالياً.',
          mainBot
        );
      }
    }
    await handleBotStepReplay(botManager);
  } catch (error) {
    console.log('🚀 ~ handleStopCommand ~ error:', error);
    throw error;
  }
};
