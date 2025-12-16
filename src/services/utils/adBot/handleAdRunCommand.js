// Import workflow step descriptions for ad bots
import { adBotSteps } from '../constants/adBotSteps.js';
// Import event types for update notifications
import { updateEvents } from '../constants/updateEvents.js';
// Function to send a private message to a user
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';
import { checkBotStep } from '../steps/checkBotStep.js';
import handleBotStepReplay from '../steps/handleBotStepReplay.js';
// Function to update the workflow step state
import setStepState from '../steps/setStepState.js';
// Function to send an update event to the client
import { sendUpdateEvent } from '../updates/sendUpdateEvent.js';
// Function to send advertisement messages in batches
import { sendPatchMessages } from './sendPatchMessages.js';

/**
 * Handles the command to run advertisement bots and send ad messages to users.
 * Validates required state, triggers batch message sending, updates workflow, and notifies the user.
 *
 *BotStateManager botManager - The bot manager instance controlling bot state.
 *string data - The command data (not used in this function).
 *Array rest - Additional command arguments (not used in this function).
 */
export const handleAdRunCommand = async (botManager) => {
  try {
    // Get the main bot instance
    const mainBot = botManager.getMainBot();
    const messagesLength = botManager.getMessages().length;
    const messagesCount = botManager.getMessageCount();
    if (!checkBotStep(botManager, 'message') || messagesCount !== messagesLength) {
      await handleBotStepReplay(botManager);
      return;
    }

    // Validate that there are users to send ads to
    if (!botManager.getUsers().length) {
      throw new Error('لا يوجد مستخدمين في القائمة');
    }
    // Validate that there are ad bots connected
    if (!botManager.getAdBots().length) {
      throw new Error('لا يوجد بوتات إعلانات متصلة');
    }
    // Validate that there are messages to send
    if (!botManager.getMessages().length) {
      throw new Error('لا يوجد رسائل في القائمة');
    }

    setStepState(botManager, 'sending');
    await sendPrivateMessage(
      botManager.config.baseConfig.orderFrom,
      `${adBotSteps.sending.description}\n${adBotSteps.sending.nextStepMessage}`,
      mainBot
    );

    // Send advertisement messages in batches using ad bots
    await sendPatchMessages(botManager);
    if (!mainBot) {
      return;
    }
    // Update workflow step to indicate ads have been sent
    setStepState(botManager, 'main');
    // Notify client about completion of ad sending
    await sendUpdateEvent(botManager, updateEvents.ad.done, { ads: botManager.getMessages().length });
    // Send a private message to the user with next step instructions
    if (botManager.getUsers().length > 0) {
      await sendPrivateMessage(
        botManager.config.baseConfig.orderFrom,
        `${adBotSteps.adsSent.description}\n
      إجمالي الأعضاء:
      ${botManager.getUsers().length}
      عدد الإعلانات:
      ${botManager.getMessagesDeliveredTo().length}`,
        mainBot, mainBot
      );
      await handleBotStepReplay(botManager);
    }

    await sendUpdateEvent(botManager, updateEvents.state.clear, {});
    await botManager.clearState();
  } catch (error) {
    // Log and rethrow errors for debugging
    console.log('🚀 ~ handleAdRunCommand ~ error:', error);
    throw error;
  }
};
