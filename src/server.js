import express from 'express';
import http from 'http';
import { Server as SoketIOServer } from 'socket.io';
import BotStateManager from './services/BotStateManager.js';
import { handleAutoRun } from './services/utils/autoRun/handleAutoRun.js';
import { updateEvents } from './services/utils/constants/updateEvents.js';
const app = express();
const PORT = 3000;

// WOLF API Client Configuration
const WOLF_CONFIG = {
  host: 'wss://v3.palringo.com',
  port: 443,
  token: '', // Replace with your actual WOLF token
  device: 'mobile',
  appCheckToken: '', // Optional

  // Proxy Configuration (optional)
  proxy: {
    enabled: true, // Set to true to enable proxy
    host: '', // Proxy IP address (e.g., "192.168.1.100")
    port: 0, // Proxy port
    username: '', // Proxy username (if required)
    password: '', // Proxy password (if required)
    protocol: 'http' // Protocol: "http", "https", or "socks5"
  }
};

const server = http.createServer(app);
const io = new SoketIOServer(server, {
  cors: {
    origin: '*'
  }
});

const clientApiMap = new Map();
const clientCleanupMap = new Map();

async function cleanupClient (clientSocket) {
  if (clientSocket.cleanupPromise) { return clientSocket.cleanupPromise; }
  const botId = clientSocket.botId;
  const manager = botId ? clientApiMap.get(botId) : null;
  if (botId && clientApiMap.get(botId) === manager) { clientApiMap.delete(botId); }

  const cleanupPromise = (async () => {
    if (manager) { await manager.clearForDisconnectState(); }
  })().finally(() => {
    if (botId && clientCleanupMap.get(botId) === cleanupPromise) { clientCleanupMap.delete(botId); }
  });
  clientSocket.cleanupPromise = cleanupPromise;
  if (botId) { clientCleanupMap.set(botId, cleanupPromise); }
  return cleanupPromise;
}

io.on('connection', async (clientSocket) => {
  try {
    // console.log('Client connected:', clientSocket.id);

    clientSocket.on('init-api', async (request) => {
      // console.log('🚀 ~ request:', request);
      const config = {
        ...request,
        mainBotConfig: {
          ...WOLF_CONFIG,
          token: request.mainBotConfig.token,
          proxy: {
            ...WOLF_CONFIG.proxy,
            enabled: !!(request.mainBotConfig.host && request.mainBotConfig.port),
            host: request.mainBotConfig.host,
            port: request.mainBotConfig.port
          }
        },
        roomBotConfig: {
          ...WOLF_CONFIG,
          token: request.roomBotConfig.token,
          proxy: {
            ...WOLF_CONFIG.proxy,
            enabled: !!(request.roomBotConfig.host && request.roomBotConfig.port),
            host: request.roomBotConfig.host,
            port: request.roomBotConfig.port
          }
        },
        adBotConfig: [
          ...request.adBotConfig.map(adBot => ({
            ...WOLF_CONFIG,
            token: adBot.token,
            proxy: {
              ...WOLF_CONFIG.proxy,
              enabled: !!(adBot.ipAddress && adBot.port),
              host: adBot.ipAddress,
              port: adBot.port
            }
          }))
        ]
      };
      const botId = request.botId;
      if (!botId) {
        clientSocket.emit('error', 'missing-bot-id');
        return clientSocket.disconnect(true);
      }

      const pendingCleanup = clientCleanupMap.get(botId);
      if (pendingCleanup) { await pendingCleanup; }
      if (!clientSocket.connected) { return; }

      // Reject if there is already a connection for this botId
      if (clientApiMap.has(botId)) {
        console.warn(`Connection attempt rejected: botId ${botId} is already connected`);
        clientSocket.emit('error', 'bot-already-connected');
        return clientSocket.disconnect(true);
      }
      const wolfStateManager = new BotStateManager(config);
      wolfStateManager.setSocket(clientSocket);
      clientSocket.botId = botId;
      clientApiMap.set(botId, wolfStateManager);
      try {
        await wolfStateManager.connect('main');
      } catch (error) {
        console.error(`Failed to initialize botId ${botId}:`, error);
        await cleanupClient(clientSocket);
        if (clientSocket.connected) { clientSocket.disconnect(true); }
        return;
      }
      if (!clientSocket.connected || wolfStateManager._destroyed) {
        await cleanupClient(clientSocket);
        return;
      }
      // console.log("🚀 ~ botId:", botId)
      if (request?.baseConfig?.autoRun) {
        await handleAutoRun(wolfStateManager);
      }
      clientSocket.emit(updateEvents.counter.update);
      clientSocket.emit('api-ready');
      // Now you can handle other events
    }); // When creating the WolfClient instance

    // Forward client events to API
    clientSocket.on('check-room-bot', (_payload) => {
      const manager = clientApiMap.get(clientSocket.botId);
      const isConnected = manager?.getRoomBots().some(bot => bot.connected);
      clientSocket.emit('bot-connection-state', { connected: isConnected, allBots: manager?.listAllBots() });
      // clientApiMap.get(clientSocket.id)?.getMa
    });

    clientSocket.on('classification:retry', async () => {
      const manager = clientApiMap.get(clientSocket.botId);
      if (manager) { await manager.handleRetryUnknownUsers(); }
    });

    clientSocket.on('classification:ignore', async () => {
      const manager = clientApiMap.get(clientSocket.botId);
      if (manager) { await manager.handleIgnoreUnknownUsers(); }
    });

    // clientSocket.on("stop-bots", async () => {
    //     await clientApiMap.get(clientSocket.id)?.clearState();
    //     console.log("Stopping bots / main bot connected:", clientApiMap.get(clientSocket.id).getMainBot().connected);
    // });

    // Disconnect on error
    clientSocket.on('error', async (err) => {
      console.error('Socket error:', err);
      if (clientSocket.cleaningUp) { return; }
      clientSocket.cleaningUp = true;
      clientSocket.disconnect();
      await cleanupClient(clientSocket);
    });

    // Cleanup on disconnect
    clientSocket.on('disconnect', async () => {
      if (clientSocket.cleaningUp) { return; }
      clientSocket.cleaningUp = true;
      await cleanupClient(clientSocket);
    });
  } catch (error) {
    console.log('🚀 ~ error:', error);
  }
});

server.listen(PORT, () => {
  console.log(`Socket.IO server is running on http://localhost:${PORT}`);
});
