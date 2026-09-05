import setStepState from '../steps/setStepState.js';
import { handleRoomCommand } from '../roomBot/handleRoomCommand.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';
import { handlePrepareCommand } from '../roomBot/handlePrepareCommand.js';
import { sendUpdateEvent } from '../updates/sendUpdateEvent.js';
import { updateEvents } from '../constants/updateEvents.js';
import { updateTimers } from '../../helpers/updateTimers.js';
import { handleAdRunCommand } from '../adBot/handleAdRunCommand.js';
import { connectAdAccountBatch } from '../adBot/adAccountConnection.js';

export const handleAdBotAutoRun = async (botManager) => {
  const mainBot = botManager.getMainBot();
  const roomBotTokens = botManager.config.roomBotConfig.token;
  roomBotTokens.forEach(token => {
    botManager.addNewRoomBotToken(token);
  });
  const roomBotToken = botManager.getRoomBotsTokens()[0];
  const adBotTokens = botManager.config.adBotConfig;
  if (!botManager.config.baseConfig.autoRun) { throw new Error('Auto run is disabled'); }
  if (!roomBotToken) { throw new Error('No room bots tokens available'); }
  if (!adBotTokens || adBotTokens.length === 0) { throw new Error('No ad bot tokens configured'); }
  const allTokensSet = adBotTokens.every(tokenConfig => tokenConfig.token);
  if (!allTokensSet) { throw new Error('All ad bot tokens must be configured'); }
  const messagingStyle = botManager.config.baseConfig.messagingStyle;
  const messages = botManager.config.baseConfig.messages;

  try {
    await handleRoomCommand(roomBotToken, botManager);
    await handlePrepareCommand(botManager);
    for (let i = 0; i < adBotTokens.length; i++) {
      const tokenConfig = adBotTokens[i];
      if (botManager.isReseting) {
        throw new Error('البوت في وضع إعادة التعيين، لا يمكن المتابعة الآن');
      }
      updateTimers(botManager, 'ad');
      // botManager.startAdBotsReconnectScheduler();
      if (!await connectAdAccountBatch(botManager, i)) { return; }

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
    console.log('🚀 ~ handleAdBotAutoRun ~ error:', error);
    await sendPrivateMessage(botManager.config.baseConfig.orderFrom, error.message, mainBot);
  }
};
