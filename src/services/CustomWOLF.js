
import { WOLF } from 'wolf.js';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { updateEvents } from './utils/constants/updateEvents.js';
import { sendUpdateEvent } from './utils/updates/sendUpdateEvent.js';

/**
 * Extended WOLF class with custom bot management features
 */
class CustomWOLF extends WOLF {
  constructor (botManager = null, botType = 'main') {
    super();
    this.botManager = botManager;
    this.botType = botType;
    this.connected = false;
    this.isBusy = false;
    this.isWorking = false;
    this._managerRegistered = false;
  }

  /**
   * Set the busy state of the bot
   */
  setIsBusy (isBusy) {
    this.isBusy = isBusy;
  }

  /**
   * Set the working state of the bot
   */
  setIsWorking (isWorking) {
    this.isWorking = isWorking;
  }

  stopSocketReconnection () {
    const socket = this.websocket?.socket;
    try { socket?.io?.reconnection?.(false); } catch {}
    // wolf.js skips disconnect() while the transport is between connections.
    // Calling Socket.IO directly also destroys a pending/reconnecting socket.
    try { socket?.disconnect?.(); } catch {}
  }

  /**
   * Create a proxy agent based on configuration
   * @param {Object} config - Configuration object (if not provided, uses stored config)
   * @returns {HttpsProxyAgent|SocksProxyAgent|null}
   */
  async createProxyAgent (config) {
    // Use provided config, or fall back to stored config
    const proxyConfig = config?.proxy || this._loginConfig?.proxy || this.config?.proxy;

    if (!proxyConfig || !proxyConfig.enabled) {
      return null;
    }

    const { protocol, host, port, username, password } = proxyConfig;

    if (!host || !port) {
      console.warn('Proxy enabled but host or port missing');
      return null;
    }

    try {
      let proxyUrl = `${protocol}://`;

      if (username && password) {
        proxyUrl += `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
      }

      proxyUrl += `${host}:${port}`;

      console.log(`🔧 Creating proxy agent: ${protocol}://${host}:${port}`);

      if (protocol === 'socks5' || protocol === 'socks') {
        return new SocksProxyAgent(proxyUrl);
      } else {
        return new HttpsProxyAgent(proxyUrl);
      }
    } catch (error) {
      console.error('Failed to create proxy agent:', error);
      return null;
    }
  }

  /**
   * Override login to handle connection state
   */
  async login (config) {
    // Return a promise that waits for the actual connection
    return new Promise((resolve, reject) => {
      const connectionTimeout = this.botType === 'room' ? 30000 : 15000;
      const timeoutId = setTimeout(async () => {
        cleanup();
        this.connected = false;
        this.stopSocketReconnection();
        if (this.botType === 'main') {
          await sendUpdateEvent(this.botManager, updateEvents.bots.main.disconnected, { state: 'disconnected' });
        }
        reject(new Error(`Connection timeout after ${connectionTimeout / 1000} seconds`));
      }, connectionTimeout);

      const handleReady = (data) => {
        clearTimeout(timeoutId);
        this.connected = true;
        this.currentSubscriber = data?.loggedInUser || this.currentSubscriber;
        cleanup();
        resolve(data);
      };

      const handleError = async (error) => {
        clearTimeout(timeoutId);
        this.connected = false;
        cleanup();

        // Send disconnect event for main bot on any connection error
        if (this.botType === 'main') {
          await sendUpdateEvent(this.botManager, updateEvents.bots.main.disconnected, { state: 'disconnected' });
        }

        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const cleanup = () => {
        this.off('ready', handleReady);
        this.off('resume', handleReady);
        this.off('connectionError', handleError);
        this.off('connectError', handleError);
      };

      // Listen for welcome event to log user info
      this.once('welcome', async (welcome) => {
        // Handle invalid login (no subscriber ID)
        if (!welcome.subscriber?.id) {
          console.error('❌ Login failed - No subscriber ID:', { botType: this.botType });
          this.stopSocketReconnection();
          await handleError(new Error('لم يتم تسجيل الحساب، الرجاء إدخال حساب آخر'));
          return;
        }

        // Successfully logged in
        console.log('🎉 Bot connected successfully:', {
          botType: this.botType,
          subscriberId: welcome.subscriber?.id,
          nickname: welcome.subscriber?.nickname,
          status: welcome.subscriber?.status,
          deviceType: welcome.deviceType
        });
      });

      // Listen for events that WOLF emits (both ready and resume)
      this.once('ready', handleReady);
      this.once('resume', handleReady);
      this.once('connectionError', handleError);
      this.once('connectError', handleError);

      // untested code
      // Listen for resume event to re-establish subscriptions after auto-reconnect
      this.on('resume', async () => {
        console.log(`🔄 Bot ${this.botType} (${this.currentSubscriber?.id}) auto-reconnected, re-establishing subscriptions...`);

        // Re-establish subscriptions for magic room bots
        if (this.botType === 'room' && this.botManager?.getBotType?.() === 'magic') {
          try {
            // Re-subscribe to channel messages
            await this.messaging._subscribeToChannel();

            // Re-subscribe to audio slots for all channels
            const channels = this.botManager.getChannels?.();
            if (channels && channels.length > 0) {
              for (const channelId of channels) {
                try {
                  await this.stage.slot.list(channelId);
                } catch (error) {
                  console.warn(`⚠️ Failed to re-subscribe to audio slots for channel ${channelId}:`, error.message);
                }
              }
              console.log(`✅ Re-subscribed to ${channels.length} channels for bot ${this.currentSubscriber?.id}`);
            }
          } catch (error) {
            console.error('Failed to re-establish subscriptions on resume:', error);
          }
        }
      });

      // Call parent login which sets up websocket and connects
      super.login(config).catch(async (error) => {
        clearTimeout(timeoutId);
        cleanup();
        this.connected = false;

        // Send disconnect event for main bot on any login error
        if (this.botType === 'main') {
          await sendUpdateEvent(this.botManager, updateEvents.bots.main.disconnected, { state: 'disconnected' });
        }

        reject(error);
      });
    });
  }

  /**
   * Override disconnect to update connection state and notify UI
   */
  async disconnect () {
    const shouldNotifyClient = this._managerRegistered;
    this._managerRegistered = false;
    try {
      console.log(`🔌 Disconnecting bot: { botType: '${this.botType}', subscriberId: ${this.currentSubscriber?.id}, nickname: '${this.currentSubscriber?.nickname}' }`);

      this.stopSocketReconnection();
      await super.disconnect();
    } finally {
      this.connected = false;

      // Notify UI based on bot type
      if (shouldNotifyClient && this.botManager?.socket) {
        const eventMap = {
          main: updateEvents.bots.main.disconnected,
          room: updateEvents.bots.room.disconnected,
          ad: updateEvents.bots.ad.disconnected
        };

        const eventName = eventMap[this.botType];
        if (eventName) {
          await sendUpdateEvent(this.botManager, eventName, {
            state: 'disconnected',
            subscriber: {
              id: this.currentSubscriber?.id,
              nickname: this.currentSubscriber?.nickname
            }
          });
        }
      }
    }
  }

  /**
   * Setup message routing for ad or magic bot type
   * @param {Object} handlers - Object with handlers for different bot types
   * @param {Function} handlers.ad - Handler for ad bot type
   * @param {Function} handlers.magic - Handler for magic bot type
   */
  setupMessageRouting (handlers) {
    if (this.botType !== 'main') {
      return; // Only main bot handles message routing
    }

    // Listen for all messages (private and group)
    this.on('message', async (message) => {
      try {
        const botType = this.botManager?.getBotType?.();
        if (!botType) { return; }

        const adminId = this.botManager?.config?.baseConfig?.orderFrom;
        // Convert adminId to number for comparison
        if (!adminId || parseInt(adminId) !== message.sourceSubscriberId) { return; }

        // Route to appropriate handler based on bot type
        if (botType === 'ad' && handlers.ad) {
          await handlers.ad(message, { botManager: this.botManager });
        } else if (botType === 'magic' && handlers.magic) {
          await handlers.magic(message, { botManager: this.botManager });
        }
      } catch (error) {
        console.error('Error handling message:', error);
      }
    });
  }
}

export default CustomWOLF;
