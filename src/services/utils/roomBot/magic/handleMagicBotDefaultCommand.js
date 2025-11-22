import { magicBotSteps } from '../../constants/magicBotSteps.js';
import { updateEvents } from '../../constants/updateEvents.js';
import { userMessages } from '../../constants/userMessages.js';
import { sendPrivateMessage } from '../../messaging/sendPrivateMessage.js';
import { sendUpdateEvent } from '../../updates/sendUpdateEvent.js';
import { getChannelList } from '../getUsersIDs.js';

export const handleMagicBotDefaultCommand = async (botManager, commandName) => {
  try {
    const mainBot = botManager.getMainBot();
    botManager.addNewRoomBotToken(commandName);
    // Connect the room bot
    const newRoomBot = await botManager.connect('room');
    // Retrieve the list of channels for the room bot
    const channels = await getChannelList(newRoomBot);
    // Extract channel IDs from the channel list (channels is already an array from WOLF API)
    const channelsIds = channels.map(channel => channel.id);
    // Update botManager with the channel IDs
    botManager.setChannels([
      ...botManager.getChannels(),
      ...channelsIds
    ]);

    // Subscribe to audio slots for all channels
    for (const channelId of channelsIds) {
      try {
        await newRoomBot.stage.slot.list(channelId);
      } catch (error) {
        console.warn(`⚠️ Failed to subscribe to audio slots for channel ${channelId}:`, error.message);
      }
    }

    await sendUpdateEvent(
      botManager,
      updateEvents.channels.update,
      { channels: channelsIds }
    );
    await sendUpdateEvent(
      botManager,
      updateEvents.room.setup,
      { token: commandName }
    );

    if (botManager.getRoomBots().length === parseInt(botManager.config.baseConfig.instanceLimit)) {
      await sendPrivateMessage(
        botManager.config.baseConfig.orderFrom,
        `${magicBotSteps.room.description}\n${magicBotSteps.room.nextStepMessage}`,
        mainBot
      );
    } else {
      await sendPrivateMessage(
        botManager.config.baseConfig.orderFrom,
        userMessages.sendNextRoomABotToken,
        mainBot
      );
    }
  } catch (error) {
    console.log('🚀 ~ handleDefaultCommand ~ error:', error);
    throw error;
  }
};
