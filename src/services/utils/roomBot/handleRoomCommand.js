// This module handles the command for preparing and connecting a room bot.
// It validates the token, connects the room bot, retrieves channel list, and updates botManager state.
import { adBotSteps } from '../constants/adBotSteps.js';
import { userMessages } from '../constants/userMessages.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';
import setStepState from '../steps/setStepState.js';
import { sendUpdateEvent } from '../updates/sendUpdateEvent.js';
import { getChannelList } from './getUsersIDs.js';
import { updateEvents } from '../constants/updateEvents.js';
import { updateTimers } from '../../helpers/updateTimers.js';
import { checkBotStep } from '../steps/checkBotStep.js';
import handleBotStepReplay from '../steps/handleBotStepReplay.js';
import { assertRoomAccountClassificationCapacity } from '../classification/classificationPool.js';
import {
  assertRoomConnectionCooldownComplete,
  startRoomConnectionCooldown
} from './roomConnectionCooldown.js';
import { assertConnectionBatchAvailable, connectBotBatch, CONNECTION_BATCH_BUSY } from '../connections/connectBotBatch.js';

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
      return;
    }
    assertRoomConnectionCooldownComplete(botManager);
    assertConnectionBatchAvailable(botManager, 'room');
    if (checkBotStep(botManager, 'room')) {
      await handleBotStepReplay(botManager);
      return;
    }
    if (!checkBotStep(botManager, 'main')) {
      await handleBotStepReplay(botManager);
      return;
    }
    // Validate the provided token format
    if (!token.startsWith('WE-')) {
      throw new Error('يرجى ادخال توكين الحساب بشكل صحيح\nWE-AAAAAAAA');
    }
    // Set the room bot token in botManager
    // botManager.setRoomBotToken(data);
    botManager.addNewRoomBotToken(token);
    updateTimers(botManager, 'room');
    // Connect the room bot
    let newRoomBot;
    try {
      [newRoomBot] = await connectBotBatch(botManager, { botType: 'room', count: 1 });
    } catch (error) {
      // The token is appended before connect() so it can be selected by the
      // connection factory. A rejected login must roll that provisional entry
      // back or later room-account state no longer matches the managed bots.
      botManager.roomBotsTokens = botManager.roomBotsTokens.slice(0, -1);
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
      startRoomConnectionCooldown(botManager);
      throw new Error(`${error.message}\n${userMessages.roomConnectionCooldownStarted}`, { cause: error });
    }
    if (channelsIds.length === 0) {
      await botManager.clearRoomBots();
      botManager.roomBotsTokens = [];
      startRoomConnectionCooldown(botManager);
      throw new Error(`لا يوجد رومات في هذا الحساب\n${userMessages.roomConnectionCooldownStarted}`);
    }
    // Update botManager with the channel IDs
    botManager.setChannels(channelsIds);

    // Check if the number of channels exceeds allowed instance limit
    if (!botManager.isRoomBotLimitValid()) {
      await botManager.clearRoomBots();
      await botManager.clearChannels();
      botManager.roomBotsTokens = [];
      startRoomConnectionCooldown(botManager);
      throw new Error(
        `لديك عدد غرف في هذا الحساب اعلى من الحد المسموح
                    عدد الغرف: ${channelsIds.length}
                    الحد المسموح: ${botManager.config.baseConfig.instanceLimit}
${userMessages.roomConnectionCooldownStarted}`
      );
    }
    setStepState(botManager, 'room');

    // Notify the user of the next step in the workflow
    await sendUpdateEvent(botManager, updateEvents.room.setup, { token });
    await sendUpdateEvent(botManager, updateEvents.channels.setup, { channels: channelsIds });
    await sendPrivateMessage(
      botManager.config.baseConfig.orderFrom,
      `
      ${adBotSteps.room.description}
       عدد الرومات ( ${channelsIds.length} )
      ${adBotSteps.room.nextStepMessage}
     `,
      mainBot, mainBot
    );
  } catch (error) {
    // Log and rethrow any errors encountered during setup
    console.log('🚀 ~ handleRoomCommand ~ error:', error);
    throw error;
  }
};
