import { handleAdAccountCommand } from '../adBot/handleAdAccountCommand.js';
import { handleAdRunCommand } from '../adBot/magic/handleAdRunCommand.js';
import { updateEvents } from '../constants/updateEvents.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';
import { getChannelList } from '../roomBot/getUsersIDs.js';
import setStepState from '../steps/setStepState.js';
import { sendUpdateEvent } from '../updates/sendUpdateEvent.js';

export const handleMagicBotAutoRun = async (botManager) => {
  const mainBot = botManager.getMainBot();
  const roomBotTokens = botManager.config.roomBotConfig.token;
  roomBotTokens.forEach(token => {
    botManager.addNewRoomBotToken(token);
  });
  const adBotToken = botManager.getAdBotsToken();
  if (!botManager.config.baseConfig.autoRun) {
    throw new Error('Auto run is disabled');
  }
  if (!roomBotTokens.length) {
    throw new Error('No room bots tokens available');
  }
  if (!adBotToken) {
    throw new Error('No ad bot token available');
  }
  const messagingStyle = botManager.config.baseConfig.messagingStyle;
  console.log('🚀 ~ handleAdBotAutoRun ~ messagingStyle:', messagingStyle);
  const messages = botManager.config.baseConfig.messages;
  try {
    setStepState(botManager, 'room');
    const results = await Promise.all(roomBotTokens.map(token => botManager.connect('room')));
    if (!results.every(promise => promise)) {
      throw new Error('Failed to connect all room bots');
    }
    const roomBots = botManager.getRoomBots();

    // Get all channel lists in parallel
    const channelResults = await Promise.all(
      roomBots.map(roomBot => getChannelList(roomBot))
    );

    // Extract all channel IDs
    let channelIds = [];
    const roomBotChannelPairs = [];

    channelResults.forEach((channels, index) => {
      const channelsIds = channels.map(channel => channel.id);
      channelIds = channelIds.concat(channelsIds);
      channelsIds.forEach(channelId => {
        roomBotChannelPairs.push({ roomBot: roomBots[index], channelId });
      });
    });

    // Subscribe to audio slots for all channels in parallel
    await Promise.all(
      roomBotChannelPairs.map(async ({ roomBot, channelId }) => {
        try {
          await roomBot.stage.slot.list(channelId);
        } catch (error) {
          console.warn(`⚠️ Failed to subscribe to audio slots for channel ${channelId}:`, error.message);
        }
      })
    );
    await sendUpdateEvent(botManager, updateEvents.channels.setup, { channels: channelIds });
    await handleAdAccountCommand(botManager, adBotToken);
    botManager.setMessageCount(messagingStyle);
    setStepState(botManager, 'adStyle');
    for (const message of messages) {
      await botManager.setMessage(message);
    }
    setStepState(botManager, 'message');
    await handleAdRunCommand(botManager);
  } catch (error) {
    console.log('🚀 ~ handleMagicBotAutoRun ~ error:', error);
    sendPrivateMessage(botManager.config.baseConfig.orderFrom, error.message, mainBot);
  }
};
