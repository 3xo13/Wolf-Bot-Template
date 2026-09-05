import { COMMANDS } from '../constants.js';
import { responseSucceeded } from '../utils.js';
import { buildTextMessages } from './buildTextMessages.js';

export default class MessagingService {
  constructor (client) {
    this.client = client;
    this.channelSubscriptionRequested = false;
    this.privateSubscriptionRequested = false;
  }

  async subscribeToChannels () {
    this.channelSubscriptionRequested = true;
    return await this.client.request(COMMANDS.messageGroupSubscribe, {
      headers: { version: 4 }
    });
  }

  async _subscribeToChannel () {
    return await this.subscribeToChannels();
  }

  async unsubscribeFromChannels (channelId) {
    this.channelSubscriptionRequested = false;
    return await this.client.request(COMMANDS.messageGroupUnsubscribe, {
      headers: { version: 4 },
      body: channelId ? { id: Number(channelId) } : undefined
    });
  }

  async _unsubscribeFromChannel (channelId) {
    return await this.unsubscribeFromChannels(channelId);
  }

  async subscribeToPrivateMessages () {
    this.privateSubscriptionRequested = true;
    return await this.client.request(COMMANDS.messagePrivateSubscribe, {
      headers: { version: 2 }
    });
  }

  async _subscribeToPrivate () {
    return await this.subscribeToPrivateMessages();
  }

  async unsubscribeFromPrivateMessages () {
    this.privateSubscriptionRequested = false;
    return await this.client.request(COMMANDS.messagePrivateUnsubscribe, {
      headers: { version: 2 }
    });
  }

  async _unsubscribeFromPrivate () {
    return await this.unsubscribeFromPrivateMessages();
  }

  async restoreSubscriptions () {
    const work = [];
    if (this.channelSubscriptionRequested) {
      work.push(this.client.request(COMMANDS.messageGroupSubscribe, {
        headers: { version: 4 }
      }, { requireReady: false }));
    }
    if (this.privateSubscriptionRequested) {
      work.push(this.client.request(COMMANDS.messagePrivateSubscribe, {
        headers: { version: 2 }
      }, { requireReady: false }));
    }
    await Promise.all(work);
  }

  async sendPrivateMessage (subscriberId, content, options = {}) {
    return await this.sendMessage(subscriberId, content, false, options);
  }

  async sendChannelMessage (channelId, content, options = {}) {
    return await this.sendMessage(channelId, content, true, options);
  }

  async sendGroupMessage (channelId, content, options = {}) {
    return await this.sendChannelMessage(channelId, content, options);
  }

  async sendMessage (recipient, content, isGroup, options = {}) {
    const messages = await buildTextMessages({
      recipient,
      content,
      isGroup,
      formatting: options.formatting,
      resolveChannelByName: name => this.client.channels.getByName(name)
    });
    const responses = [];
    for (const message of messages) {
      responses.push(await this.client.request(COMMANDS.messageSend, message, options.request));
    }
    return responses.length === 1
      ? responses[0]
      : {
          success: responses.every(responseSucceeded),
          code: 207,
          body: responses
        };
  }
}
