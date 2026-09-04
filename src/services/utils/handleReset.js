import { updateEvents } from './constants/updateEvents.js';
import { userMessages } from './constants/userMessages.js';
import { sendUpdateEvent } from './updates/sendUpdateEvent.js';
import { sendPrivateMessage } from './messaging/sendPrivateMessage.js';
import { startRoomConnectionCooldown } from './roomBot/roomConnectionCooldown.js';

export const handleReset = async (botManager) => {
  botManager.isReseting = true;
  try {
    const mainBot = botManager.getMainBot();
    await botManager.resetState({ keepResetting: true });
    startRoomConnectionCooldown(botManager);
    await sendPrivateMessage(botManager.config.baseConfig.orderFrom, userMessages.stateReset, mainBot, mainBot);
    await sendUpdateEvent(botManager, updateEvents.state.reset, {});
  } catch (error) {
    console.log('🚀 ~ handleReset ~ error:', error);
    throw error;
  } finally {
    botManager.isReseting = false;
  }
};
