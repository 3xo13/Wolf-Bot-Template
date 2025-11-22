import { handleAdAccountCommand } from '../adBot/handleAdAccountCommand.js';
import { handleAdRunCommand } from '../adBot/magic/handleAdRunCommand.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';
import setStepState from '../steps/setStepState.js';

export const handleMagicBotAutoRun = async (botManager) => {
  const mainBot = botManager.getMainBot();
  const roomBotTokens = botManager.config.roomBotConfig.token;
  roomBotTokens.forEach(token => {
    botManager.addNewRoomBotToken(token);
  });
  const adBotToken = botManager.getAdBotsToken();
  if (!botManager.config.baseConfig.autoRun) { throw new Error('Auto run is disabled'); }
  if (!roomBotTokens.length) { throw new Error('No room bots tokens available'); }
  if (!adBotToken) { throw new Error('No ad bot token available'); }
  const messagingStyle = botManager.config.baseConfig.messagingStyle;
  console.log('🚀 ~ handleAdBotAutoRun ~ messagingStyle:', messagingStyle);
  const messages = botManager.config.baseConfig.messages;
  try {
    setStepState(botManager, 'room');
    await Promise.all(roomBotTokens.map(token => botManager.connect('room')));
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
