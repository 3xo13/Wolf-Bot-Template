/* eslint-disable no-tabs */
import { sendPrivateMessage } from './messaging/sendPrivateMessage.js';

const handleShowMessagesCommand = async (botManager) => {
  try {
    const mainBot = botManager.getMainBot();
    const messages = botManager.getMessages();
    const messageCount = botManager.getMessageCount();
    const messagesString = `نمط الارسال
		${messageCount === 1 ? 'رسالة واحدة' : messageCount === 3 ? 'ثلاث رسائل' : 'غير محدد'}\n
		${messages[0] ? 'الرسالة الأولى' : ''}
		${messages[0] || ''}\n
		${messages[1] ? 'الرسالة الثانية' : ''}
		${messages[1] || ''}\n
		${messages[2] ? 'الرسالة الثالثة' : ''}
		${messages[2] || ''}`;
    await sendPrivateMessage(botManager.config.baseConfig.orderFrom, messagesString, mainBot);
  } catch (error) {
    console.log('🚀 ~ handleShowMessagesCommand ~ error:', error);
    throw error;
  }
};

export default handleShowMessagesCommand;
