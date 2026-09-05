import PalringoClient from './palringo/PalringoClient.js';
import { updateEvents } from './utils/constants/updateEvents.js';
import { sendUpdateEvent } from './utils/updates/sendUpdateEvent.js';

/**
 * Application adapter around the focused Palringo protocol client.
 */
class CustomWOLF extends PalringoClient {
  constructor (botManager = null, botType = 'main', dependencies = {}) {
    super({}, dependencies);
    this.botManager = botManager;
    this.botType = botType;
    this.isBusy = false;
    this.isWorking = false;
    this._managerRegistered = false;

    this.on('resume', () => {
      console.log(`Bot ${this.botType} (${this.currentSubscriber?.id}) auto-reconnected and restored subscriptions.`);
    });
    this.on('subscriptionRestoreFailed', errors => {
      console.error(`Bot ${this.botType} (${this.currentSubscriber?.id}) reconnected but could not restore every subscription:`, errors);
    });
  }

  setIsBusy (isBusy) {
    this.isBusy = isBusy;
  }

  setIsWorking (isWorking) {
    this.isWorking = isWorking;
  }

  stopSocketReconnection () {
    const socket = this.websocket?.socket;
    try { socket?.io?.reconnection?.(false); } catch {}
    try { socket?.disconnect?.(); } catch {}
  }

  async login (config) {
    const connectionTimeout = this.botType === 'room' ? 30000 : 15000;

    try {
      const subscriber = await super.login({
        ...config,
        connectTimeout: connectionTimeout,
        authenticationTimeout: connectionTimeout
      });

      if (this.botType === 'main') {
        await Promise.all([
          this.messaging.subscribeToPrivateMessages(),
          this.messaging.subscribeToChannels()
        ]);
      }

      console.log('Bot connected successfully:', {
        botType: this.botType,
        subscriberId: subscriber?.id,
        nickname: subscriber?.nickname,
        status: subscriber?.status
      });
      return subscriber;
    } catch (error) {
      if (this.botType === 'main') {
        await sendUpdateEvent(this.botManager, updateEvents.bots.main.disconnected, { state: 'disconnected' });
      }
      throw error;
    }
  }

  async disconnect () {
    const shouldNotifyClient = this._managerRegistered;
    const subscriber = this.currentSubscriber;
    this._managerRegistered = false;
    try {
      console.log(`Disconnecting bot: { botType: '${this.botType}', subscriberId: ${subscriber?.id}, nickname: '${subscriber?.nickname}' }`);
      this.stopSocketReconnection();
      if (this.transport) {
        await super.disconnect();
      } else {
        await this.websocket?.disconnect?.();
      }
    } finally {
      if (shouldNotifyClient && this.botManager?.socket) {
        const eventName = {
          main: updateEvents.bots.main.disconnected,
          room: updateEvents.bots.room.disconnected,
          ad: updateEvents.bots.ad.disconnected
        }[this.botType];

        if (eventName) {
          await sendUpdateEvent(this.botManager, eventName, {
            state: 'disconnected',
            subscriber: {
              id: subscriber?.id,
              nickname: subscriber?.nickname
            }
          });
        }
      }
    }
  }

  setupMessageRouting (handlers) {
    if (this.botType !== 'main') { return; }

    this.on('message', async message => {
      try {
        const botType = this.botManager?.getBotType?.();
        if (!botType) { return; }

        const adminId = this.botManager?.config?.baseConfig?.orderFrom;
        if (!adminId || parseInt(adminId) !== message.sourceSubscriberId) { return; }

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
