import CustomWOLF from '../CustomWOLF.js';
import { handleAdBotCommand } from '../utils/handleAdBotCommand.js';
import { handleMagicBotCommand } from '../utils/handleMagicBotCommand.js';
import { handleGroupMessage } from '../utils/roomBot/magic/handleGroupMessage.js';

export async function connectFn (manager, botType) {
  const { mainBotConfig, roomBotConfig, adBotConfig } = manager.config;
  let botInstance;
  switch (botType) {
    case 'main':
      botInstance = new CustomWOLF(manager, 'main');
      await botInstance.login(mainBotConfig);
      manager.mainBot = botInstance;

      // Setup message routing for ad and magic bot types
      botInstance.setupMessageRouting({
        ad: handleAdBotCommand,
        magic: handleMagicBotCommand
      });

      // Start the manager-owned reconnect scheduler for the main bot
      try {
        if (typeof manager.startMainBotReconnectScheduler === 'function') { manager.startMainBotReconnectScheduler(); }
      } catch (_e) { }
      break;
    case 'room': {
      botInstance = new CustomWOLF(manager, 'room');
      const roomConfig = { ...roomBotConfig, token: manager.roomBotsTokens.at(-1) };
      await botInstance.login(roomConfig);
      manager.roomBots.push(botInstance);

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
            await handleGroupMessage(manager, message);
          } catch (error) {
            console.error('Error handling channel message:', error);
          }
        });

        // Also listen for generic 'message' event for group messages
        botInstance.on('message', async (message) => {
          try {
            if (message.isGroup) {
              await handleGroupMessage(manager, message);
            }
          } catch (error) {
            console.error('Error handling group message:', error);
          }
        });

        // Listen for channel audio updates (voice messages, audio in stage)
        botInstance.on('channelAudioUpdate', async (update) => {
          try {
            await handleGroupMessage(manager, update);
          } catch (error) {
            console.error('Error handling channel audio update:', error);
          }
        });

        // Listen for channel audio slot updates
        botInstance.on('channelAudioSlotUpdate', async (update) => {
          try {
            await handleGroupMessage(manager, update);
          } catch (error) {
            console.error('Error handling channel audio slot update:', error);
          }
        });

        // Listen for group audio slot updates (has subscriberId)
        botInstance.on('groupAudioSlotUpdate', async (update) => {
          try {
            await handleGroupMessage(manager, update);
          } catch (error) {
            console.error('Error handling group audio slot update:', error);
          }
        });

        console.log(`✅ Room bot ${botInstance.currentSubscriber?.id} listening for channel messages and audio updates`);
      }
      break;
    }
    case 'ad':
      botInstance = new CustomWOLF(manager, 'ad');
      await botInstance.login(adBotConfig);
      manager.adBots.push(botInstance);
      break;
    default:
      throw new Error(`Unknown bot type: ${botType}`);
  }
  return botInstance;
}

export default connectFn;
