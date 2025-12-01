import { handleReset } from '../utils/handleReset.js';
import { handleDefaultCommand } from './handleDefaultCommand.js';
import { handleStateReport } from '../utils/handleStateReport.js';
import { handleRoomCommand } from './roomBot/handleRoomCommand.js';
import { handleAdRunCommand } from './adBot/handleAdRunCommand.js';
import { sendPrivateMessage } from './messaging/sendPrivateMessage.js';
import { handleStopCommand } from '../utils/adBot/handleStopCommand.js';
import { handlePrepareCommand } from './roomBot/handlePrepareCommand.js';
import { handleAdAccountCommand } from './adBot/handleAdAccountCommand.js';
// removed explicit ad message command: messages will be entered directly after adStyle
import { handleMessageCountCommand } from './adBot/handleMessageCountCommand.js';
import handleShowMessagesCommand from './handleShowMessagesCommand.js';
import handleMessagesChangeCommand from './handleMessagesChangeCommand.js';
import handleHelpCommand from '../handleHelpCommand.js';

export const handleAdBotCommand = async (command, args) => {
  const { clientSocket, botManager } = args;
  const mainBot = botManager.getMainBot();
  if (botManager.isPreparing) {
    await sendPrivateMessage(
      botManager.config.baseConfig.orderFrom,
      'يرجى الانتظار ...',
      mainBot, mainBot
    );
    return;
  }
  try {
    const [commandName, data, ...rest] = command.body.split('\n');
    switch (commandName) {
      case 'حساب رومات':
        await handleRoomCommand(data, botManager);
        return;

      case 'تجهيز':
        await handlePrepareCommand(botManager);
        return;

      case 'حساب اعلان':
        await handleAdAccountCommand(botManager, data);
        return;

      case '1':
      case '2':
        await handleMessageCountCommand(commandName, botManager);
        return;

      case 'تشغيل':
        await handleAdRunCommand(botManager);
        return;

      case 'وقف':
        await handleStopCommand(botManager);
        return;

      case 'اعاده تعيين البوت':
        await handleReset(botManager);
        return;

      case 'حاله البوت':
        await handleStateReport(botManager);
        return;

      case 'عرض رساله اعلان':
        await handleShowMessagesCommand(botManager);
        return;

      case 'تغيير رساله اعلان':
        await handleMessagesChangeCommand(botManager);
        return;

      case 'مساعده':
        await handleHelpCommand(botManager);
        return;

      default:
        await handleDefaultCommand(botManager, command);
        break;
    }
  } catch (error) {
    console.log('🚀 ~ handleCommand ~ error:', error);
    await sendPrivateMessage(botManager.config.baseConfig.orderFrom, error.message, mainBot, mainBot);
  }
};
