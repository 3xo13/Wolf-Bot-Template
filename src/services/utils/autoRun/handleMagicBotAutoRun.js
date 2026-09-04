import { updateTimers } from '../../helpers/updateTimers.js';
import { handleAdRunCommand } from '../adBot/magic/handleAdRunCommand.js';
import { updateEvents } from '../constants/updateEvents.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';
import { getChannelList } from '../roomBot/getUsersIDs.js';
import setStepState from '../steps/setStepState.js';
import { sendUpdateEvent } from '../updates/sendUpdateEvent.js';
import {
  assertRoomAccountClassificationCapacity,
  assertRoomBotPoolCapacity,
  ensureClassificationBots
} from '../classification/classificationPool.js';

export const handleMagicBotAutoRun = async (botManager) => {
  const mainBot = botManager.getMainBot();
  const roomBotTokens = botManager.config.roomBotConfig.token;
  const adBotTokens = botManager.config.adBotConfig;
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
  if (!adBotTokens || adBotTokens.length === 0) { throw new Error('No ad bot tokens configured'); }
  const allTokensSet = adBotTokens.every(tokenConfig => tokenConfig.token);
  if (!allTokensSet) { throw new Error('All ad bot tokens must be configured'); }
  const messagingStyle = botManager.config.baseConfig.messagingStyle;
  const messages = botManager.config.baseConfig.messages;
  try {
    assertRoomBotPoolCapacity(roomBotTokens.length);
    setStepState(botManager, 'room');
    const results = await Promise.all(roomBotTokens.map(token => botManager.connect('room')));
    if (!results.every(promise => promise)) {
      throw new Error('Failed to connect all room bots');
    }
    const roomBots = botManager.getRoomBots();
    await ensureClassificationBots(botManager);

    // Get all channel lists in parallel
    const channelResults = await Promise.all(
      roomBots.map(roomBot => getChannelList(roomBot))
    );
    try {
      channelResults.forEach(channels => assertRoomAccountClassificationCapacity(channels.length));
    } catch (error) {
      await botManager.clearRoomBots();
      throw error;
    }

    // Extract all channel IDs
    let channelIds = [];
    const roomBotChannelPairs = [];

    channelResults.forEach((channels, index) => {
      if (botManager.isReseting) {
        throw new Error('البوت في وضع إعادة التعيين، لا يمكن المتابعة الآن');
      }
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
    const instanceCount = botManager.config.baseConfig.instanceCount;
    for (let i = 0; i < adBotTokens.length; i++) {
      if (botManager.isReseting) {
        throw new Error('البوت في وضع إعادة التعيين، لا يمكن المتابعة الآن');
      }
      const tokenConfig = adBotTokens[i];

      updateTimers(botManager, 'ad');
      // botManager.startAdBotsReconnectScheduler();
      // Connect the required number of ad bots
      try {
        await Promise.all(
          Array.from({ length: instanceCount }, () => botManager.connect('ad', i))
        );
      } catch (error) {
        // If any connection fails, disconnect and clear all ad bots
        await botManager.clearAdBots();
        await sendPrivateMessage(
          botManager.config.baseConfig.orderFrom,
          '❌ فشل في الاتصال بأحد بوتات الإعلانات، يرجى التحقق من التوكن أو تغيير الحساب ',
          mainBot, mainBot
        );
        throw error;
      }

      // Notify the user that ad bots are ready and provide next step instructions
      await sendUpdateEvent(botManager, updateEvents.ad.setup, { token: tokenConfig.token, index: i });
      await sendPrivateMessage(
        botManager.config.baseConfig.orderFrom,
        `حساب الإعلان رقم ( ${i + 1} ) متصل بنجاح`,
        mainBot, mainBot
      );
    }
    // Update the workflow state to indicate ad step
    setStepState(botManager, 'ad');
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
