/* eslint-disable no-tabs */
// This file handles the command for setting the number of messages to send per user.
// It validates the input, updates the message count, and notifies the user of the next step.

import { adBotSteps } from '../constants/adBotSteps.js';
import { updateEvents } from '../constants/updateEvents.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';
import { checkBotStep } from '../steps/checkBotStep.js';
import handleBotStepReplay from '../steps/handleBotStepReplay.js';
import setStepState from '../steps/setStepState.js';
import { sendUpdateEvent } from '../updates/sendUpdateEvent.js';

export const handleMessageCountCommand = async (command, botManager) => {
  try {
    const messageCountAsNumber = parseInt(command.trim());
    const messageCount = messageCountAsNumber === 1 ? 1 : messageCountAsNumber === 2 ? 3 : 0;
    if (messageCount === 0 || typeof messageCountAsNumber !== 'number') {
      throw new Error(`يرجى ادخال عدد الرسائل بشكل صحيح
				1 أو 2 `);
    }
    const mainBot = botManager.getMainBot();
    // Parse and validate the message count value
    if (!checkBotStep(botManager, 'ad') || !botManager.getAdBots().length) {
      await handleBotStepReplay(botManager);
      return;
    }
    // Update the message count in the workflow state
    botManager.setMessageCount(messageCount);
    setStepState(botManager, 'adStyle');
    // Notify the user of the next step
    await sendUpdateEvent(botManager, updateEvents.messagingStyle.setup, { num: messageCount });
    await sendPrivateMessage(
      botManager.config.baseConfig.orderFrom,
      `${adBotSteps.adStyle.description}
      ${messageCountAsNumber === 1 ? adBotSteps.adStyle.nextStepMessage : 'أرسل رسالة الإعلان رقم ( 1 )'}
      `,
      mainBot, mainBot
    );
  } catch (error) {
    // Log and rethrow any errors encountered during processing
    console.log('🚀 ~ handleMessageCountCommand ~ error:', error);
    throw error;
  }
};
