// This file handles the command for setting advertisement messages to be sent by ad bots.
// It validates input, sets messages based on the message count, updates workflow state, and notifies the user.

import { adBotSteps } from '../constants/adBotSteps.js';
import { updateEvents } from '../constants/updateEvents.js';
import { userMessages } from '../constants/userMessages.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js'; // Used to send notifications to the user
import { checkBotStep } from '../steps/checkBotStep.js';
import setStepState from '../steps/setStepState.js';

import { sendUpdateEvent } from '../updates/sendUpdateEvent.js';

export const handleAdMessageCommand = async (botManager, command) => {
  const [commandName, data, ...rest] = command.body.split('\n');
  try {
    // Get the main bot and message count
    const mainBot = botManager.getMainBot();
    const messageCount = botManager.getMessageCount();
    const adBots = botManager.getAdBots();
    const botType = botManager.getBotType();
    // Check if there are users to send messages to
    if (botType === 'ad' && !botManager.getUsers().length) {
      throw new Error('لا يوجد مستخدمين في القائمة');
    }
    if (!checkBotStep(botManager, 'adStyle')) {
      throw new Error('خطوة غير صحيحة\nالرجاء ادخال نمط الاعلانات أولا');
    }
    // Check if there are ad bots connected
    if (!adBots.length || !adBots.every(bot => bot.connected)) {
      await botManager.clearAdBots();
      throw new Error('لا يوجد بوتات إعلانات متصلة');
    }
    // Validate that message content is provided
    if (!data) {
      throw new Error('يرجى ادخال محتوى الرسالة');
    }

    setStepState(botManager, 'message');
    // If only one message is to be sent
    if (messageCount === 1) {
      await botManager.setMessage(data); // Set the single message
      await sendPrivateMessage(
        botManager.config.baseConfig.orderFrom,
        `${adBotSteps.message.description}\n${adBotSteps.message.nextStepMessage}`,
        mainBot
      );
      await sendUpdateEvent(botManager, updateEvents.message.setup, { message: [data, ...rest].join('\n'), index: 1 });
      return;
    } else if (messageCount === 3) {
      // If three messages are to be sent, validate and set all three
      await botManager.setMessage(command.body); // Set the single message
      await sendPrivateMessage(
        botManager.config.baseConfig.orderFrom,
        userMessages.sendNextMessage,
        mainBot,
        mainBot
      );
      await sendUpdateEvent(botManager, updateEvents.message.setup, { message: command.body, index: 1 });
      return;
    } else {
      // If message count is not valid, throw an error
      throw new Error('عدد الرسائل غير صحيح');
    }
  } catch (error) {
    // Log and rethrow any errors encountered during processing
    console.log('🚀 ~ handleAdMessageCommand ~ error:', error);
    throw error;
  }
};
