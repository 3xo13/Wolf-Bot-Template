/* eslint-disable no-tabs */
import { getStep } from './getStep.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';

/**
 * Check the bot's current step and send an appropriate message based on that step
 * @param {Object} botManager - The bot manager instance
 * @param {number} userId - The user ID to send the message to
 * @returns {Promise<void>}
 */
const handleBotStepReplay = async (botManager) => {
  try {
    const userId = botManager.config.baseConfig.orderFrom;
    const mainBot = botManager.getMainBot();
    if (!mainBot) {
      console.error('Main bot not available');
      return;
    }

    // Get current step number
    const currentStepNumber = botManager.getCurrentStep();
    if (!currentStepNumber) {
      await sendPrivateMessage(
        userId,
        '❌ لا توجد خطوة نشطة حاليًا',
        mainBot
      );
      return;
    }

    // Get step details
    const step = getStep(currentStepNumber, botManager);
    if (!step) {
      await sendPrivateMessage(
        userId,
        '❌ خطأ في تحديد الخطوة الحالية',
        mainBot
      );
      return;
    }

    // Build status message
    const statusMessage = `🔹 ${step.description}\n\n` +
			`➡️ ${step.nextStepMessage}`;

    // Send the status message
    await sendPrivateMessage(userId, statusMessage, mainBot);
  } catch (error) {
    console.error('Error in handleBotStepReplay:', error);
  }
};

export default handleBotStepReplay;
