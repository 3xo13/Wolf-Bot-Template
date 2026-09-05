import CustomWOLF from '../CustomWOLF.js';
import { handleAdBotCommand } from '../utils/handleAdBotCommand.js';
import { handleMagicBotCommand } from '../utils/handleMagicBotCommand.js';
import { handleGroupMessage } from '../utils/roomBot/magic/handleGroupMessage.js';
import { updateEvents } from '../utils/constants/updateEvents.js';

async function loginOrDispose (bot, config) {
  try {
    return await bot.login(config);
  } catch (error) {
    // A failed initial login is not owned by the manager yet. Stop Socket.IO's
    // automatic reconnection so it cannot survive as an orphan connection.
    bot.connected = false;
    try { bot.stopSocketReconnection?.(); } catch {}
    try { await bot.websocket?.disconnect(); } catch {}
    throw error;
  }
}

export function registerConnectedBot (manager, botType, botInstance, generation, typeGeneration) {
  const typeGenerationChanged = typeGeneration !== undefined &&
    typeGeneration !== manager._connectionTypeGenerations?.[botType];
  if (manager.isReseting || manager._destroyed || generation !== manager._connectionGeneration || typeGenerationChanged) {
    return false;
  }
  if (botType === 'main') {
    manager.mainBot = botInstance;
  } else if (botType === 'room') {
    manager.roomBots.push(botInstance);
  } else if (botType === 'ad') {
    manager.adBots.push(botInstance);
  }
  botInstance._managerRegistered = true;
  const eventName = {
    main: updateEvents.bots.main.connected,
    room: updateEvents.bots.room.connected,
    ad: updateEvents.bots.ad.connected
  }[botType];
  if (eventName) {
    manager.emit(eventName, {
      subscriber: {
        id: botInstance.currentSubscriber?.id,
        nickname: botInstance.currentSubscriber?.nickname
      }
    });
  }
  return true;
}

async function rejectStaleConnection (manager, botType, botInstance, generation, typeGeneration) {
  if (registerConnectedBot(manager, botType, botInstance, generation, typeGeneration)) { return; }
  try { await botInstance.disconnect(); } catch {}
  const error = new Error('Bot connection was cancelled by reset');
  error.code = 'BOT_CONNECTION_CANCELLED';
  throw error;
}

export async function connectFn (manager, botType, adBotIndex) {
  if (manager.isReseting) {
    throw new Error('البوت في وضع إعادة التعيين، لا يمكن المتابعة الآن');
  }
  const connectionGeneration = manager._connectionGeneration;
  const connectionTypeGeneration = manager._connectionTypeGenerations?.[botType] || 0;
  const { mainBotConfig, roomBotConfig, adBotConfig } = manager.config;
  let botInstance;
  switch (botType) {
    case 'main':
      botInstance = new CustomWOLF(manager, 'main');
      await loginOrDispose(botInstance, mainBotConfig);
      await rejectStaleConnection(manager, botType, botInstance, connectionGeneration, connectionTypeGeneration);

      // Setup message routing for ad and magic bot types
      botInstance.setupMessageRouting({
        ad: handleAdBotCommand,
        magic: handleMagicBotCommand
      });

      // Start the manager-owned reconnect scheduler for the main bot
      // try {
      //   if (typeof manager.startMainBotReconnectScheduler === 'function') { manager.startMainBotReconnectScheduler(); }
      // } catch (_e) { }
      break;
    case 'room': {
      botInstance = new CustomWOLF(manager, 'room');
      const roomConfig = { ...roomBotConfig, token: manager.roomBotsTokens.at(-1) };
      await loginOrDispose(botInstance, roomConfig);
      await rejectStaleConnection(manager, botType, botInstance, connectionGeneration, connectionTypeGeneration);

      // For magic bots, set up group message and update listeners
      if (manager.getBotType() === 'magic') {
        // Subscribe to channel messages and updates
        try {
          await botInstance.messaging._subscribeToChannel();
        } catch (error) {
          console.error('Failed to subscribe to channel messages:', error);
        }

        // Listen for channel/group messages (text messages)
        botInstance.on('channelMessage', async (message) => {
          try {
            await handleGroupMessage(manager, message, botInstance);
          } catch (error) {
            console.error('Error handling channel message:', error);
          }
        });

        // Also listen for generic 'message' event for group messages
        botInstance.on('message', async (message) => {
          try {
            if (message.isGroup) {
              await handleGroupMessage(manager, message, botInstance);
            }
          } catch (error) {
            console.error('Error handling group message:', error);
          }
        });

        // Listen for channel audio updates (voice messages, audio in stage)
        botInstance.on('channelAudioUpdate', async (update) => {
          try {
            await handleGroupMessage(manager, update, botInstance);
          } catch (error) {
            console.error('Error handling channel audio update:', error);
          }
        });

        // Listen for channel audio slot updates
        botInstance.on('channelAudioSlotUpdate', async (update) => {
          try {
            await handleGroupMessage(manager, update, botInstance);
          } catch (error) {
            console.error('Error handling channel audio slot update:', error);
          }
        });

        // Listen for group audio slot updates (has subscriberId)
        botInstance.on('groupAudioSlotUpdate', async (update) => {
          try {
            await handleGroupMessage(manager, update, botInstance);
          } catch (error) {
            console.error('Error handling group audio slot update:', error);
          }
        });
      }
      break;
    }
    case 'ad':
      botInstance = new CustomWOLF(manager, 'ad');
      if (!adBotConfig[adBotIndex]) {
        throw new Error(`Ad bot configuration not found at index ${adBotIndex}`);
      }
      await loginOrDispose(botInstance, { ...adBotConfig[adBotIndex] });
      await rejectStaleConnection(manager, botType, botInstance, connectionGeneration, connectionTypeGeneration);
      break;
    default:
      throw new Error(`Unknown bot type: ${botType}`);
  }
  return botInstance;
}

export default connectFn;
