import { magicBotSteps } from '../../constants/magicBotSteps.js';
import { updateEvents } from '../../constants/updateEvents.js';
import { userMessages } from '../../constants/userMessages.js';
import { sendPrivateMessage } from '../../messaging/sendPrivateMessage.js';
import { sendUpdateEvent } from '../../updates/sendUpdateEvent.js';
import { getChannelList } from '../getUsersIDs.js';
import {
  assertRoomAccountClassificationCapacity,
  assertRoomBotPoolCapacity,
  ensureClassificationBots,
  reserveClassificationCapacityForRoomBots
} from '../../classification/classificationPool.js';
import {
  assertRoomConnectionCooldownComplete,
  startRoomConnectionCooldown
} from '../roomConnectionCooldown.js';

export const handleMagicBotDefaultCommand = async (botManager, commandName) => {
  try {
    const mainBot = botManager.getMainBot();
    assertRoomConnectionCooldownComplete(botManager);
    const futureRoomBotCount = botManager.getRoomBots().length + 1;
    assertRoomBotPoolCapacity(futureRoomBotCount);
    await reserveClassificationCapacityForRoomBots(botManager, futureRoomBotCount);
    botManager.addNewRoomBotToken(commandName);
    // Connect the room bot
    let newRoomBot;
    try {
      newRoomBot = await botManager.connect('room');
    } catch (error) {
      botManager.roomBotsTokens = botManager.roomBotsTokens.slice(0, -1);
      await ensureClassificationBots(botManager);
      startRoomConnectionCooldown(botManager);
      const connectionError = new Error(`${error.message}\n${userMessages.roomConnectionCooldownStarted}`);
      connectionError.cause = error;
      throw connectionError;
    }
    // Retrieve the list of channels for the room bot
    const channels = await getChannelList(newRoomBot);
    // Extract channel IDs from the channel list (channels is already an array from WOLF API)
    const channelsIds = channels.map(channel => channel.id);
    try {
      assertRoomAccountClassificationCapacity(channelsIds.length);
    } catch (error) {
      botManager.removeBot('room', newRoomBot);
      await newRoomBot.disconnect();
      botManager.roomBotsTokens = botManager.roomBotsTokens.slice(0, -1);
      await ensureClassificationBots(botManager);
      throw error;
    }

    if (channelsIds.length === 0) {
      await botManager.clearRoomBots();
      throw new Error('لا يوجد رومات في هذا الحساب');
    }
    // Update botManager with the channel IDs
    botManager.setChannels([
      ...botManager.getChannels(),
      ...channelsIds
    ]);
    await ensureClassificationBots(botManager);

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
