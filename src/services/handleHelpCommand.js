/* eslint-disable no-tabs */
import { sendPrivateMessage } from './utils/messaging/sendPrivateMessage.js';

/**
 * Send a list of all available commands based on the bot manager type
 * @param {Object} botManager - The bot manager instance
 * @param {number} userId - The user ID to send the help message to
 * @returns {Promise<void>}
 */
const handleHelpCommand = async (botManager) => {
  try {
    const userId = botManager.config.baseConfig.orderFrom;
    const mainBot = botManager.getMainBot();
    if (!mainBot) {
      console.error('Main bot not available');
      return;
    }

    const botType = botManager.getBotType();
    let helpMessage = '';

    if (botType === 'ad') {
      helpMessage = 'حساب رومات\n' +
				'تجهيز\n' +
				'حساب اعلان\n' +
				'1\n' +
				'2\n' +
				'ع اعلان\n' +
				'ت اعلان\n' +
				'تشغيل\n' +
				'وقف\n' +
				'حاله البوت\n' +
				'اعاده تعيين البوت';
    } else if (botType === 'magic') {
      helpMessage = 'حساب رومات\n' +
				'حساب اعلان\n' +
				'1\n' +
				'2\n' +
				'ع اعلان\n' +
				'ت اعلان\n' +
				'تشغيل\n' +
				'وقف\n' +
				'حاله البوت\n' +
				'اعاده تعيين البوت';
    } else {
      helpMessage = '❌ نوع البوت غير محدد. الرجاء إعداد البوت أولاً.';
    }

    await sendPrivateMessage(userId, helpMessage, mainBot);
  } catch (error) {
    console.error('Error in handleHelpCommand:', error);
  }
};

export default handleHelpCommand;
