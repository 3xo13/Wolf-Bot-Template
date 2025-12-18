// This module handles the command for preparing and connecting a room bot.
// It validates the token, connects the room bot, retrieves channel list, and updates botManager state.
import { sendPrivateMessage } from '../../messaging/sendPrivateMessage.js';
import setStepState from '../../steps/setStepState.js';
import { sendUpdateEvent } from '../../updates/sendUpdateEvent.js';
import { getChannelList } from '../getUsersIDs.js';
import { updateEvents } from '../../constants/updateEvents.js';
import { magicBotSteps } from '../../constants/magicBotSteps.js';
import { userMessages } from '../../constants/userMessages.js';
import { updateTimers } from '../../../helpers/updateTimers.js';
import { checkBotStep } from '../../steps/checkBotStep.js';
import handleBotStepReplay from '../../steps/handleBotStepReplay.js';

/**
 * Handles the room bot setup command.
 * - Validates the bot token
 * - Connects the room bot
 * - Retrieves the list of channels for the bot
 * - Updates botManager with channel IDs
 * - Notifies the user of the next step
 *  string commandName - The command name being processed
 *  string data - The token or data for the room bot
 *  BotStateManager botManager - The central state manager for all bots and workflow
 */
export const handleRoomCommand = async (token, botManager) => {
  try {
    // Get the main bot instance
    const mainBot = botManager.getMainBot();
    // If main bot is not connected, reset state and exit
    if (!mainBot || !mainBot.connected) {
      console.log('🚀 ~ mainBot state:', !mainBot || !mainBot.connected);
      setStepState(botManager, '', '');
      return;
    }
    if (checkBotStep(botManager, 'room') || !checkBotStep(botManager, 'main')) {
      await handleBotStepReplay(botManager);
      return;
    }
    // Validate the provided token format
    if (!token.startsWith('WE-')) {
      throw new Error('يرجى ادخال توكين الحساب بشكل صحيح\nWE-AAAAAAAA');
    }
    // Set the room bot token in botManager
    botManager.addNewRoomBotToken(token);

    const instanceCount = botManager.config.baseConfig.instanceLimit;

    // Connect the room bot
    const newRoomBot = await botManager.connect('room');

    updateTimers(botManager, 'room');
    // botManager.startRoomBotsReconnectScheduler();
    // Retrieve the list of channels for the room bot
    const channels = await getChannelList(newRoomBot);
    // Extract channel IDs from the channel list (channels is already an array from WOLF API)
    const channelsIds = channels.map(channel => channel.id);

    if (channelsIds.length === 0) {
      await botManager.clearRoomBots();
      throw new Error('لا يوجد رومات في هذا الحساب');
    }

    // Check if the number of channels exceeds allowed instance limit
    if (!botManager.isRoomBotLimitValid()) {
      throw new Error(
        `لديك عدد غرف في هذا الحساب اعلى من الحد المسموح
                    عدد الغرف: ${channelsIds.length}
                    الحد المسموح: ${botManager.config.baseConfig.instanceLimit}`
      );
    }

    // Update botManager with the channel IDs
    botManager.setChannels(channelsIds);

    // For magic bots, subscribe to audio slots for all channels
    if (botManager.getBotType() === 'magic') {
      for (const channelId of channelsIds) {
        if (botManager.isReseting) {
          throw new Error('عملية إعادة التعيين جارية، تم إلغاء الاشتراك في فتحات الصوت.');
        }
        try {
          await newRoomBot.stage.slot.list(channelId);
        } catch (error) {
          console.warn(`⚠️ Failed to subscribe to audio slots for channel ${channelId}:`, error.message);
        }
      }
    }

    // send client updates
    await sendUpdateEvent(botManager, updateEvents.room.setup, { token });
    await sendUpdateEvent(botManager, updateEvents.channels.setup, { channels: channelsIds });

    setStepState(botManager, 'room');

    if (instanceCount > botManager.getRoomBots().length) {
      await sendPrivateMessage(
        botManager.config.baseConfig.orderFrom,
        userMessages.sendNextRoomABotToken,
        mainBot, mainBot
      );
    } else {
      await sendPrivateMessage(
        botManager.config.baseConfig.orderFrom,
        `${magicBotSteps.room.description}
         عدد الرومات ( ${channelsIds.length} )
        ${magicBotSteps.room.nextStepMessage}`,
        mainBot, mainBot
      );
    }
  } catch (error) {
    // Log and rethrow any errors encountered during setup
    console.log('🚀 ~ handleRoomCommand ~ error:', error);
    throw error;
  }
};
