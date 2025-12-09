
// This module handles the preparation step for room bots in the workflow.
// It connects room bots to channels, extracts channel members, and updates botManager state.
// Used during step 2 of the bot workflow to gather all members from all channels.
import { adBotSteps } from '../constants/adBotSteps.js';
import { updateEvents } from '../constants/updateEvents.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';
import setStepState from '../steps/setStepState.js';
import { sendUpdateEvent } from '../updates/sendUpdateEvent.js';
import { extractChannelMembers } from './getUsersIDs.js';
import { checkBotStep } from '../steps/checkBotStep.js';
import handleBotStepReplay from '../steps/handleBotStepReplay.js';

/**
 * Prepares room bots by connecting them to channels and extracting members.
 * BotStateManager botManager - The central state manager for all bots and workflow.
 */
export const handlePrepareCommand = async (botManager) => {
  botManager.setIsBusy(true);
  // Get main bot and first room bot
  const mainBot = botManager.getMainBot();
  try {
    const roomBot = botManager.getRoomBots()[0];

    if (!checkBotStep(botManager, 'room') || !botManager.getRoomBots().length) {
      await handleBotStepReplay(botManager);
      return;
    }

    // Check if room bot is connected and authenticated
    if (!roomBot.connected || !roomBot.currentSubscriber) {
      roomBot.disconnect();
      throw new Error('بوت الرووم غير متصل\nيرجى تغيير الحساب');
    }

    botManager.isPreparing = true;
    await sendPrivateMessage(
      botManager.config.baseConfig.orderFrom,
      'جاري التجهيز...',
      mainBot, mainBot
    );

    // mark all room bots as working
    botManager.getRoomBots().forEach(bot => bot.setIsWorking(true));

    // Get all channel IDs from botManager
    const channels = botManager.getChannels();

    // Connect a room bot to each channel
    await Promise.all(channels.map(channelId => botManager.connect('room')));

    // Get all connected room bots
    const roomBots = botManager.getRoomBots();

    // Pair each channel with its corresponding room bot
    const channelBotPairs = channels.map((channelId, index) => ([
      channelId, roomBots[index]
    ]));

    // Initialize each room bot by fetching its channel list
    // This populates the inChannel flag for channels the bot is already in
    await Promise.all(roomBots.map(async (bot) => {
      try {
        await bot.channel.list();
      } catch (error) {
        console.log('⚠️ Failed to initialize bot:', error.message);
      }
    }));

    // Extract members from each channel using its room bot
    const result = await Promise.all(channelBotPairs.map(async ([channelId, bot]) => {
      try {
        const extractResult = await extractChannelMembers(bot, botManager, channelId);
        return extractResult;
      } catch (error) {
        console.log(`❌ Failed to extract members from channel ${channelId}:`, error.message);
        return false;
      }
    }));

    // If extraction succeeded, update state and notify user
    if (result) {
      setStepState(botManager, 'members');
      console.log('✅ Total users extracted:', botManager.getUsers().length);
      // Disconnect all room bots after extraction
      await botManager.clearChannels();
      await botManager.clearRoomBots();
      await sendUpdateEvent(botManager, updateEvents.users.setup, { users: botManager.getUsers().length });
      // Notify user of next step
      await sendPrivateMessage(
        botManager.config.baseConfig.orderFrom,
        `${adBotSteps.members.description}\n${adBotSteps.members.nextStepMessage}
      `,
        mainBot, mainBot
      );
    } else {
      await botManager.clearRoomBots();
      await botManager.clearChannels();
      throw new Error('لم يتم استخراج الاعضاء, يرجى المحاولة مجددا');
    }
  } catch (error) {
    // Log and throw error if preparation fails
    console.log('🚀 ~ handlePrepareCommand ~ error:', error);
    await sendPrivateMessage(
      botManager.config.baseConfig.orderFrom,
      'فشل في تجهيز بوت الغرفة, يرجى المحاولة مجددا',
      mainBot, mainBot
    );
    throw error;
  } finally {
    botManager.setIsBusy(false);
    botManager.isPreparing = false;
  }
};
