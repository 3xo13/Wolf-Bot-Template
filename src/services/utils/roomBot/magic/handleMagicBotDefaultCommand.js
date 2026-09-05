import { updateEvents } from '../../constants/updateEvents.js';
import { userMessages } from '../../constants/userMessages.js';
import { sendPrivateMessage } from '../../messaging/sendPrivateMessage.js';
import { sendUpdateEvent } from '../../updates/sendUpdateEvent.js';
import { getChannelList } from '../getUsersIDs.js';
import {
  assertRoomAccountClassificationCapacity,
  assertRoomBotPoolCapacity,
  ensureClassificationBots
} from '../../classification/classificationPool.js';
import {
  assertRoomConnectionCooldownComplete,
  startRoomConnectionCooldown
} from '../roomConnectionCooldown.js';
import { assertConnectionBatchAvailable, connectBotBatch, CONNECTION_BATCH_BUSY } from '../../connections/connectBotBatch.js';
import {
  buildNextRoomAccountMessage,
  buildRoomAccountsCompleteMessage
} from './roomAccountMessages.js';

export const handleMagicBotDefaultCommand = async (botManager, commandName) => {
  try {
    const mainBot = botManager.getMainBot();
    assertRoomConnectionCooldownComplete(botManager);
    assertConnectionBatchAvailable(botManager, 'room');
    const futureRoomBotCount = botManager.getRoomBots().length + 1;
    assertRoomBotPoolCapacity(futureRoomBotCount);
    botManager.addNewRoomBotToken(commandName);
    // Connect the room bot
    let newRoomBot;
    try {
      [newRoomBot] = await connectBotBatch(botManager, { botType: 'room', count: 1 });
    } catch (error) {
      botManager.roomBotsTokens = botManager.roomBotsTokens.slice(0, -1);
      await ensureClassificationBots(botManager);
      if (error.code === CONNECTION_BATCH_BUSY) { throw error; }
      startRoomConnectionCooldown(botManager);
      const connectionError = new Error(`${error.message}\n${userMessages.roomConnectionCooldownStarted}`);
      connectionError.cause = error;
      throw connectionError;
    }
    // Retrieve the list of channels for the room bot
    let channels;
    try {
      channels = await getChannelList(newRoomBot);
    } catch (error) {
      botManager.removeBot('room', newRoomBot);
      await newRoomBot.disconnect();
      botManager.roomBotsTokens = botManager.roomBotsTokens.slice(0, -1);
      await ensureClassificationBots(botManager);
      startRoomConnectionCooldown(botManager);
      throw new Error(`${error.message}\n${userMessages.roomConnectionCooldownStarted}`, { cause: error });
    }
    // Extract channel IDs from the channel list (channels is already an array from WOLF API)
    const channelsIds = channels.map(channel => channel.id);
    try {
      assertRoomAccountClassificationCapacity(channelsIds.length);
    } catch (error) {
      botManager.removeBot('room', newRoomBot);
      await newRoomBot.disconnect();
      botManager.roomBotsTokens = botManager.roomBotsTokens.slice(0, -1);
      await ensureClassificationBots(botManager);
      startRoomConnectionCooldown(botManager);
      throw new Error(`${error.message}\n${userMessages.roomConnectionCooldownStarted}`, { cause: error });
    }

    if (channelsIds.length === 0) {
      botManager.removeBot('room', newRoomBot);
      await newRoomBot.disconnect();
      botManager.roomBotsTokens = botManager.roomBotsTokens.slice(0, -1);
      await ensureClassificationBots(botManager);
      startRoomConnectionCooldown(botManager);
      throw new Error(`لا يوجد رومات في هذا الحساب\n${userMessages.roomConnectionCooldownStarted}`);
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
        buildRoomAccountsCompleteMessage(
          botManager.getRoomBots().length,
          botManager.getChannels().length
        ),
        mainBot
      );
    } else {
      await sendPrivateMessage(
        botManager.config.baseConfig.orderFrom,
        buildNextRoomAccountMessage(botManager.getRoomBots().length, channelsIds.length),
        mainBot
      );
    }
  } catch (error) {
    console.log('🚀 ~ handleDefaultCommand ~ error:', error);
    throw error;
  }
};
