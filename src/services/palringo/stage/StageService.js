import { COMMANDS } from '../constants.js';
import { asPositiveInteger } from '../utils.js';

export default class StageService {
  constructor (client) {
    this.client = client;
    this.subscribedChannelIds = new Set();
    this.slot = this;
  }

  async listSlots (channelId, { subscribe = true } = {}) {
    const id = asPositiveInteger(channelId, 'channelId');
    const response = await this.client.request(COMMANDS.groupAudioSlotList, { id, subscribe });
    if (subscribe) { this.subscribedChannelIds.add(id); }
    return Array.isArray(response?.body) ? response.body : [];
  }

  async list (channelId, subscribe = true) {
    return await this.listSlots(channelId, { subscribe });
  }

  async restoreSubscriptions () {
    for (const channelId of this.subscribedChannelIds) {
      await this.client.request(COMMANDS.groupAudioSlotList, {
        id: channelId,
        subscribe: true
      }, { requireReady: false });
    }
  }

  clear () {
    this.subscribedChannelIds.clear();
  }
}
