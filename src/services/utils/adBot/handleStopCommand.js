import { updateEvents } from '../constants/updateEvents.js';
import { userMessages } from '../constants/userMessages.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';
import { checkBotStep } from '../steps/checkBotStep.js';
import { sendUpdateEvent } from '../updates/sendUpdateEvent.js';
import { startAuthenticatedConnectionCooldowns } from '../roomBot/roomConnectionCooldown.js';

export const handleStopCommand = async (botManager) => {
  let stopped = false;
  try {
    const mainBot = botManager.getMainBot();
    const isRunning = botManager.botType === 'ad'
      ? checkBotStep(botManager, 'sending')
      : checkBotStep(botManager, 'messaging');
    if (!isRunning) {
      await sendPrivateMessage(
        botManager.config.baseConfig.orderFrom,
        'البوت لا يعمل حالياً.',
        mainBot
      );
      return;
    }

    botManager.isReseting = true;
    await botManager.clearState({ keepResetting: true });
    startAuthenticatedConnectionCooldowns(botManager);
    await sendUpdateEvent(botManager, updateEvents.state.clear, {});
    await sendPrivateMessage(
      botManager.config.baseConfig.orderFrom,
      userMessages.stateCleared,
      mainBot,
      mainBot
    );
    stopped = true;
  } catch (error) {
    console.log('🚀 ~ handleStopCommand ~ error:', error);
    throw error;
  } finally {
    if (stopped || botManager.isReseting) { botManager.isReseting = false; }
  }
};
