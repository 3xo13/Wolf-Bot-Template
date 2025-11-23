import { handleReset } from './handleReset.js';
import { checkBotStep } from './steps/checkBotStep.js';
import { handleStateReport } from './handleStateReport.js';
import { handleStopCommand } from './adBot/handleStopCommand.js';
import { handleDefaultCommand } from './handleDefaultCommand.js';
import { sendPrivateMessage } from './messaging/sendPrivateMessage.js';
import { handleAdRunCommand } from './adBot/magic/handleAdRunCommand.js';
import { handleRoomCommand } from './roomBot/magic/handleRoomCommand.js';
import { handleAdAccountCommand } from './adBot/handleAdAccountCommand.js';
import { handleMessageCountCommand } from './adBot/handleMessageCountCommand.js';
import { handleMagicBotDefaultCommand } from './roomBot/magic/handleMagicBotDefaultCommand.js';
import handleMessagesChangeCommand from './handleMessagesChangeCommand.js';
import handleShowMessagesCommand from './handleShowMessagesCommand.js';
import handleBotStepReplay from './steps/handleBotStepReplay.js';
import handleHelpCommand from '../handleHelpCommand.js';

export const handleMagicBotCommand = async (command, args) => {
  const { clientSocket, botManager } = args;
  const mainBot = botManager.getMainBot();
  try {
    const [commandName, data, ...rest] = command
      .body
      .split('\n');
    switch (commandName) {
      case 'حساب رومات':
        await handleRoomCommand(data, botManager);
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

      case 'تغيير رساله اعلان':
        await handleMessagesChangeCommand(botManager);
        return;

      case 'عرض رساله اعلان':
        await handleShowMessagesCommand(botManager);
        return;

      case 'مساعده':
        await handleHelpCommand(botManager);
        return;

      default:
        if (checkBotStep(botManager, 'room') && commandName.startsWith('WE-') && botManager.getRoomBots().length < botManager.config.baseConfig.instanceLimit) {
          await handleMagicBotDefaultCommand(botManager, commandName);
        } else if (checkBotStep(botManager, 'adStyle') || checkBotStep(botManager, 'message')) {
          await handleDefaultCommand(botManager, command);
        } else {
          await handleBotStepReplay(botManager);
        }

        break;
    }
  } catch (error) {
    console.log('🚀 ~ handleCommand ~ error:', error);
    await sendPrivateMessage(
      botManager.config.baseConfig.orderFrom,
      error.message,
      mainBot, mainBot
    );
  }
};
