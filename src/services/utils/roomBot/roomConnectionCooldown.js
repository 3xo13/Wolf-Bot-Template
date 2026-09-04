import { userMessages } from '../constants/userMessages.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';

export const ROOM_CONNECTION_COOLDOWN_MS = 60 * 1000;

export function clearRoomConnectionCooldown (botManager) {
  botManager._roomConnectionCooldownGeneration = (botManager._roomConnectionCooldownGeneration || 0) + 1;
  if (botManager.roomConnectionCooldownTimer) {
    clearTimeout(botManager.roomConnectionCooldownTimer);
  }
  botManager.roomConnectionCooldownTimer = null;
  botManager.roomConnectionCooldownUntil = 0;
  botManager.roomConnectionCooldownNextCommand = null;
}

export function getRoomConnectionCooldownSeconds (botManager) {
  return Math.max(0, Math.ceil(((botManager.roomConnectionCooldownUntil || 0) - Date.now()) / 1000));
}

export function assertRoomConnectionCooldownComplete (botManager) {
  const seconds = getRoomConnectionCooldownSeconds(botManager);
  if (seconds > 0) {
    throw new Error(userMessages.roomConnectionCooldownWarning(seconds));
  }
}

export function startRoomConnectionCooldown (
  botManager,
  { duration = ROOM_CONNECTION_COOLDOWN_MS, nextCommand = 'room' } = {}
) {
  clearRoomConnectionCooldown(botManager);
  const generation = botManager._roomConnectionCooldownGeneration;
  botManager.roomConnectionCooldownUntil = Date.now() + duration;
  botManager.roomConnectionCooldownNextCommand = nextCommand;
  botManager.roomConnectionCooldownTimer = setTimeout(async () => {
    if (generation !== botManager._roomConnectionCooldownGeneration || botManager._destroyed) { return; }
    botManager.roomConnectionCooldownTimer = null;
    botManager.roomConnectionCooldownUntil = 0;
    botManager.roomConnectionCooldownNextCommand = null;
    const mainBot = botManager.getMainBot?.();
    if (!mainBot?.connected || botManager.isReseting) { return; }
    try {
      await sendPrivateMessage(
        botManager.config.baseConfig.orderFrom,
        nextCommand === 'prepare'
          ? userMessages.preparationConnectionCooldownComplete
          : userMessages.roomConnectionCooldownComplete,
        mainBot,
        mainBot
      );
    } catch (error) {
      console.warn('Failed to send room connection cooldown prompt:', error.message);
    }
  }, duration);
  botManager.roomConnectionCooldownTimer.unref?.();
  return botManager.roomConnectionCooldownUntil;
}
