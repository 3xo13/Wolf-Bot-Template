import { userMessages } from '../constants/userMessages.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';

export const ROOM_CONNECTION_COOLDOWN_MS = 60 * 1000;
export const AD_CONNECTION_COOLDOWN_MS = 60 * 1000;

function clearCooldown (botManager, type) {
  const prefix = type === 'ad' ? 'ad' : 'room';
  const generationKey = `_${prefix}ConnectionCooldownGeneration`;
  const timerKey = `${prefix}ConnectionCooldownTimer`;
  const untilKey = `${prefix}ConnectionCooldownUntil`;
  const nextCommandKey = `${prefix}ConnectionCooldownNextCommand`;

  botManager[generationKey] = (botManager[generationKey] || 0) + 1;
  if (botManager[timerKey]) { clearTimeout(botManager[timerKey]); }
  botManager[timerKey] = null;
  botManager[untilKey] = 0;
  botManager[nextCommandKey] = null;
}

function getCooldownSeconds (botManager, type) {
  const prefix = type === 'ad' ? 'ad' : 'room';
  return Math.max(0, Math.ceil(((botManager[`${prefix}ConnectionCooldownUntil`] || 0) - Date.now()) / 1000));
}

function assertCooldownComplete (botManager, type) {
  const seconds = getCooldownSeconds(botManager, type);
  if (seconds > 0) {
    throw new Error(type === 'ad'
      ? userMessages.adConnectionCooldownWarning(seconds)
      : userMessages.roomConnectionCooldownWarning(seconds));
  }
}

function startCooldown (botManager, type, { duration, nextCommand, notify = true }) {
  const prefix = type === 'ad' ? 'ad' : 'room';
  const generationKey = `_${prefix}ConnectionCooldownGeneration`;
  const timerKey = `${prefix}ConnectionCooldownTimer`;
  const untilKey = `${prefix}ConnectionCooldownUntil`;
  const nextCommandKey = `${prefix}ConnectionCooldownNextCommand`;
  clearCooldown(botManager, type);
  const generation = botManager[generationKey];
  botManager[untilKey] = Date.now() + duration;
  botManager[nextCommandKey] = nextCommand;
  botManager[timerKey] = setTimeout(async () => {
    if (generation !== botManager[generationKey] || botManager._destroyed) { return; }
    botManager[timerKey] = null;
    botManager[untilKey] = 0;
    botManager[nextCommandKey] = null;
    if (!notify) { return; }
    const mainBot = botManager.getMainBot?.();
    if (!mainBot?.connected || botManager.isReseting) { return; }
    const message = type === 'ad'
      ? userMessages.adConnectionCooldownComplete
      : nextCommand === 'prepare'
        ? userMessages.preparationConnectionCooldownComplete
        : userMessages.roomConnectionCooldownComplete;
    try {
      await sendPrivateMessage(botManager.config.baseConfig.orderFrom, message, mainBot, mainBot);
    } catch (error) {
      console.warn(`Failed to send ${type} connection cooldown prompt:`, error.message);
    }
  }, duration);
  botManager[timerKey].unref?.();
  return botManager[untilKey];
}

export function clearRoomConnectionCooldown (botManager) {
  clearCooldown(botManager, 'room');
}

export function getRoomConnectionCooldownSeconds (botManager) {
  return getCooldownSeconds(botManager, 'room');
}

export function assertRoomConnectionCooldownComplete (botManager) {
  assertCooldownComplete(botManager, 'room');
}

export function startRoomConnectionCooldown (
  botManager,
  { duration = ROOM_CONNECTION_COOLDOWN_MS, nextCommand = 'room' } = {}
) {
  return startCooldown(botManager, 'room', { duration, nextCommand, notify: true });
}

export function clearAdConnectionCooldown (botManager) {
  clearCooldown(botManager, 'ad');
}

export function getAdConnectionCooldownSeconds (botManager) {
  return getCooldownSeconds(botManager, 'ad');
}

export function assertAdConnectionCooldownComplete (botManager) {
  assertCooldownComplete(botManager, 'ad');
}

export function startAdConnectionCooldown (
  botManager,
  { duration = AD_CONNECTION_COOLDOWN_MS, notify = true } = {}
) {
  return startCooldown(botManager, 'ad', { duration, nextCommand: 'ad', notify });
}

export function clearAuthenticatedConnectionCooldowns (botManager) {
  clearRoomConnectionCooldown(botManager);
  clearAdConnectionCooldown(botManager);
}

export function startAuthenticatedConnectionCooldowns (
  botManager,
  { duration = ROOM_CONNECTION_COOLDOWN_MS, nextCommand = 'room' } = {}
) {
  startRoomConnectionCooldown(botManager, { duration, nextCommand });
  startAdConnectionCooldown(botManager, { duration, notify: false });
}
