import setStepState from '../steps/setStepState.js';
import { handleRoomCommand } from '../roomBot/handleRoomCommand.js';
import { handleAdRunCommand } from '../adBot/handleAdRunCommand.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';
import { handlePrepareCommand } from '../roomBot/handlePrepareCommand.js';
import { handleAdAccountCommand } from '../adBot/handleAdAccountCommand.js';

export const handleAdBotAutoRun = async (botManager) => {
  const mainBot = botManager.getMainBot();
  const roomBotTokens = botManager.config.roomBotConfig.token;
  roomBotTokens.forEach(token => {
    botManager.addNewRoomBotToken(token);
  });
  const roomBotToken = botManager.getRoomBotsTokens()[0];
  const adBotToken = botManager.getAdBotsToken();
  if (!botManager.config.baseConfig.autoRun) { throw new Error('Auto run is disabled'); }
  if (!roomBotToken) { throw new Error('No room bots tokens available'); }
  if (!adBotToken) { throw new Error('No ad bot token available'); }
  const messagingStyle = botManager.config.baseConfig.messagingStyle;
  console.log('🚀 ~ handleAdBotAutoRun ~ messagingStyle:', messagingStyle);
  const messages = botManager.config.baseConfig.messages;

  try {
    await handleRoomCommand(roomBotToken, botManager);
    await handlePrepareCommand(botManager);
    await handleAdAccountCommand(botManager, adBotToken);
    botManager.setMessageCount(messagingStyle);
    setStepState(botManager, 'adStyle');
    for (const message of messages) {
      await botManager.setMessage(message);
    }
    console.log('messages : ', botManager.getMessages());
    setStepState(botManager, 'message');
    await handleAdRunCommand(botManager);
  } catch (error) {
    console.log('🚀 ~ handleAdBotAutoRun ~ error:', error);
    await sendPrivateMessage(botManager.config.baseConfig.orderFrom, error.message, mainBot);
  }
};
