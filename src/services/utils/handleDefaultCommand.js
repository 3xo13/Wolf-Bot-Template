// Import workflow step descriptions for ad bots
import { adBotSteps } from './constants/adBotSteps.js';
// Import event types for update notifications
import { updateEvents } from './constants/updateEvents.js';
// Import user-facing message templates
// Function to send a private message to a user
import { sendPrivateMessage } from './messaging/sendPrivateMessage.js';
import { checkBotStep } from './steps/checkBotStep.js';
import handleBotStepReplay from './steps/handleBotStepReplay.js';
import setStepState from './steps/setStepState.js';
// Function to send an update event to the client
import { sendUpdateEvent } from './updates/sendUpdateEvent.js';

/**
 * Handles default commands sent to the bot when no specific command matches.
 * Validates message count, updates workflow state, and sends appropriate user feedback.
 *
 *  botManager - The bot manager instance controlling bot state.
 *  command - The command object containing the message body.
 */
export const handleDefaultCommand = async (botManager, command) => {
  try {
    // Get the main bot instance
    const mainBot = botManager.getMainBot();
    // Get the required number of messages to be set
    const messageCount = botManager.getMessageCount();
    // Get the current number of messages already set
    const messagesLength = botManager.getMessages().length;

    // If we are in the adStyle step, accept messages directly as the admin input
    if (checkBotStep(botManager, 'adStyle')) {
      const mainBot = botManager.getMainBot();
      const messageCountNow = botManager.getMessageCount();
      const adBots = botManager.getAdBots();
      const botType = botManager.getBotType();

      if (botType === 'ad' && !botManager.getUsers().length) {
        await sendPrivateMessage(
          botManager.config.baseConfig.orderFrom,
          'لا يوجد مستخدمين في القائمة',
          mainBot,
          mainBot
        );
        return;
      }

      if (botType === 'ad') {
        if (!adBots.length || !adBots.every(bot => bot.connected)) {
          await botManager.clearAdBots();
          throw new Error('لا يوجد بوتات إعلانات متصلة');
        }
      }

      if (!command.body) {
        throw new Error('يرجى ادخال محتوى الرسالة');
      }

      // Move to message step and store message(s)
      setStepState(botManager, 'message');

      if (messageCountNow === 1) {
        await botManager.setMessage(command.body);
        await sendPrivateMessage(
          botManager.config.baseConfig.orderFrom,
          `${adBotSteps.message.description}\n${adBotSteps.message.nextStepMessage}`,
          mainBot, mainBot
        );
        await sendUpdateEvent(botManager, updateEvents.message.setup, { message: [command.body].join('\n'), index: 1 });
        return;
      } else if (messageCountNow === 3) {
        await botManager.setMessage(command.body);
        await sendPrivateMessage(
          botManager.config.baseConfig.orderFrom,
          'أرسل رسالة الإعلان رقم ( 2 )',
          mainBot, mainBot
        );
        await sendUpdateEvent(botManager, updateEvents.message.setup, { message: command.body, index: 1 });
        return;
      } else {
        throw new Error('نمط الرسائل غير صحيح');
      }
    }

    // If more messages are needed, process the new message
    if (checkBotStep(botManager, 'message')) {
      if (messageCount > messagesLength) {
        console.log(
          '🚀 ~ handleAdBotCommand ~ messageCount > messagesLength:',
          messageCount > messagesLength
        );
        // Add the new message to the bot manager
        await botManager.setMessage(command.body);
        // Notify the client about the updated message setup
        await sendUpdateEvent(botManager, updateEvents.message.setup, {
          message: command.body,
          index: messagesLength + 1 === messageCount ? 3 : 2
        });
        // If all required messages are now set, send step completion message
        if (messagesLength + 1 === messageCount) {
          await sendPrivateMessage(
            botManager.config.baseConfig.orderFrom,
            `${adBotSteps.message.description}\n${adBotSteps.message.nextStepMessage}`,
            mainBot, mainBot
          );
        } else {
          // Otherwise, prompt user to send the next message
          await sendPrivateMessage(
            botManager.config.baseConfig.orderFrom,
            'أرسل رسالة الإعلان رقم ( 3 )',
            mainBot, mainBot
          );
        }
      } else {
        // If too many messages or invalid command, notify the user
        await handleBotStepReplay(botManager);
        return;
      }
    }
  } catch (error) {
    // Log and rethrow errors for debugging
    console.log('🚀 ~ handleDefaultCommand ~ error:', error);
    throw error;
  }
};
