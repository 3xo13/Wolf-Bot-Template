import { connectFn } from './BotStateManagerMethods/connect.js';
import { updateChannelUserFn } from './BotStateManagerMethods/updateChannelUser.js';
import { listAllBotsFn } from './BotStateManagerMethods/listAllBots.js';
import { getStateFn } from './BotStateManagerMethods/getState.js';
import { startMainBotReconnectSchedulerFn } from './BotStateManagerMethods/startMainBotReconnectScheduler.js';
import { stopMainBotReconnectSchedulerFn } from './BotStateManagerMethods/stopMainBotReconnectScheduler.js';
import { runMainBotReconnectFn } from './BotStateManagerMethods/runMainBotReconnect.js';
import { startGroupReconnectSchedulerFn } from './BotStateManagerMethods/startGroupReconnectScheduler.js';
import { stopGroupReconnectSchedulerFn } from './BotStateManagerMethods/stopGroupReconnectScheduler.js';
import { runGroupReconnectFn } from './BotStateManagerMethods/runGroupReconnect.js';
import { handleIgnoreUnknownUsers, handleRetryUnknownUsers } from './utils/classification/unknownUsers.js';

class BotStateManager {
  constructor (config) {
    this.config = config;
    this.mainBot = null; // Main bot instance
    this.roomBots = []; // Array of room bot instances
    this.adBots = []; // Array of ad bot instances
    this.adBotsCount = this.config.adBotConfig.length || 0;
    this.users = new Set(); // Set of unique user IDs
    this.eligibleUsers = this.users;
    this.excludedUsers = new Set();
    this.unknownUsers = new Set();
    this.classifyingUsers = new Set();
    this.seenUsers = new Set();
    this.classificationQueue = [];
    this.classificationQueueIndex = 0;
    this.classificationInFlight = 0;
    this.classificationProducers = 0;
    this.classificationState = 'idle';
    this.ignoreUnknownUsers = false;
    this.slowRetryTimer = null;
    this.slowRetryWake = null;
    this.slowRetryPromise = null;
    this.magicClassificationPromises = new Map();
    this.magicUnknownRetryAt = new Map();
    this._classificationGeneration = 0;
    this._recipientWaiters = new Set();
    this.messagesDeliverdeTo = new Set(); // Set of user IDs to whom messages have been delivered
    this.lastUserIndex = 0;
    this.channels = new Map(); // Map of channelId -> channel info
    this.socket = null; // Socket connection instance
    this.currentStep = 1; // Current step in the process
    this.messages = new Set(); // Message texts for display
    this.messageCount = 0;
    this.channelUsers = new Map();
    this.channelUsersToMessageQueue = new Map();
    this.adBotsQueue = [];
    this.channelsAdsSent = 0;
    this.roomBotsTokens = [];
    this.isBusy = false;
    this.mainBotReconnectTimer = null;
    this.roomBotsReconnectTimer = null;
    this.adBotsReconnectTimer = null;
    this._mainBotSchedulerRef = null;
    this.isPreparing = false;
    this._activePreparationGeneration = null;
    this.botType = config.baseConfig.botType || 'ad'; // 'ad' or 'magic'
    this.isReseting = false;
    this._destroyed = false; // Flag to indicate if the manager has been destroyed
    this._disconnectCleanupPromise = null;
  }

  // Set the socket connection instance
  setSocket (socket) {
    this.socket = socket;
  }

  // Send an event to the client via socket
  emit (eventName, data) {
    if (this.socket) {
      this.socket.emit(eventName, data);
    }
  }

  // Create and connect a new bot instance based on type
  async connect (botType, adBotIndex) { return connectFn(this, botType, adBotIndex); }
  async handleRetryUnknownUsers () { return handleRetryUnknownUsers(this); }
  async handleIgnoreUnknownUsers () { return handleIgnoreUnknownUsers(this); }

  // Getters for state
  getMainBot () { return this.mainBot; }
  getRoomBots () { return this.roomBots; }
  getAdBots () { return this.adBots; }
  getUsers () { return Array.from(this.users); }
  getChannels () { return Array.from(this.channels.values()); }
  getCurrentStep () { return this.currentStep; }
  getMessageCount () { return this.messageCount; }
  getMessages () { return Array.from(this.messages); }
  getLastUserIndex () { return this.lastUserIndex; }
  getMessagesDeliveredTo () { return Array.from(this.messagesDeliverdeTo); }
  getChannelMessagingTimer () {
    return this.config.baseConfig.channelMessagingTimer;
  }

  getBotType () {
    return this.config.baseConfig.botType;
  }

  getChannelUsers () {
    return Array.from(this.channelUsers.keys());
  }

  getChannelUsersToMessageQueue () {
    return Array.from(this.channelUsersToMessageQueue.values());
  }

  getRoomBotsTokens () { return Array.from(this.roomBotsTokens); }
  getAdBotsToken () { return this.config.adBotConfig.token; }

  // setters
  setMessageCount (count) { this.messageCount = count; };
  addAdBotToQueue (bot) { this.adBotsQueue.push(bot); };
  setLastUserIndex (index) { this.lastUserIndex = index; };
  setMessage (message) {
    // store the original text for display and return a simple entry
    this.messages.add(message);
    return { original: message };
  };

  // removed stored messages API — messages are built on send
  setChannel (channel) { this.channels.set(channel, channel); };
  setCurrentStep (step) { this.currentStep = step; };
  addUser (userId) { this.users.add(userId); };
  enqueueCandidate (userId) {
    const id = String(userId);
    if (!id || this.seenUsers.has(id)) { return false; }
    this.seenUsers.add(id);
    if (!this.config.baseConfig.excludeAdmins) {
      this.classifyUser(id, false);
    } else {
      this.classificationQueue.push(id);
    }
    this.signalRecipientChange();
    return true;
  }

  takeClassificationPatch (size = 50, allowPartial = true) {
    const start = this.classificationQueueIndex;
    const available = this.classificationQueue.length - start;
    if (available <= 0 || (!allowPartial && available < size)) { return []; }
    const patch = this.classificationQueue.slice(start, start + size);
    this.classificationQueueIndex += patch.length;
    if (this.classificationQueueIndex > 10000 && this.classificationQueueIndex * 2 > this.classificationQueue.length) {
      this.classificationQueue = this.classificationQueue.slice(this.classificationQueueIndex);
      this.classificationQueueIndex = 0;
    }
    return patch;
  }

  classifyUser (userId, excluded) {
    const id = String(userId);
    this.unknownUsers.delete(id);
    this.magicUnknownRetryAt.delete(id);
    if (excluded) {
      this.excludedUsers.add(id);
      this.eligibleUsers.delete(id);
    } else if (!this.excludedUsers.has(id)) {
      this.eligibleUsers.add(id);
    }
    this.signalRecipientChange();
  }

  markUserUnknown (userId) {
    const id = String(userId);
    if (!this.eligibleUsers.has(id) && !this.excludedUsers.has(id)) { this.unknownUsers.add(id); }
  }

  getClassificationCounts () {
    return { eligible: this.eligibleUsers.size, excluded: this.excludedUsers.size, unknown: this.unknownUsers.size };
  }

  emitClassificationStatus (state) {
    if (state) { this.classificationState = state; }
    this.emit('classification:status', { ...this.getClassificationCounts(), state: this.classificationState });
  }

  signalRecipientChange () {
    for (const resolve of this._recipientWaiters) { resolve(); }
    this._recipientWaiters.clear();
  }

  waitForRecipientChange (milliseconds = 1000) {
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); this._recipientWaiters.delete(done); resolve(); };
      const timer = setTimeout(done, milliseconds);
      this._recipientWaiters.add(done);
    });
  }

  hasPendingClassification () {
    return this.classificationInFlight > 0 ||
      this.classificationQueueIndex < this.classificationQueue.length ||
      (this.unknownUsers.size > 0 && !this.ignoreUnknownUsers && this.classificationState === 'retrying');
  }

  isClassificationCancelled (generation = this._classificationGeneration) {
    return this.isReseting || this._destroyed || generation !== this._classificationGeneration;
  }

  cancelClassification () {
    this._classificationGeneration++;
    if (this.slowRetryTimer) { clearTimeout(this.slowRetryTimer); }
    if (this.slowRetryWake) { this.slowRetryWake(); }
    this.slowRetryTimer = null;
    this.slowRetryWake = null;
    this.slowRetryPromise = null;
    this.magicClassificationPromises.clear();
    this.magicUnknownRetryAt.clear();
    this.signalRecipientChange();
  }

  clearClassificationState () {
    this.cancelClassification();
    this.users.clear();
    this.excludedUsers.clear();
    this.unknownUsers.clear();
    this.classifyingUsers.clear();
    this.seenUsers.clear();
    this.classificationQueue = [];
    this.classificationQueueIndex = 0;
    this.classificationInFlight = 0;
    this.classificationProducers = 0;
    this.classificationState = 'idle';
    this.ignoreUnknownUsers = false;
    this.emitClassificationStatus('idle');
  }

  setRoomBotToken (token) { this.config.roomBotConfig.token = token; };
  setAdBotToken (token, index) { this.config.adBotConfig[index].token = token; };
  setIsBusy (isBusy) { this.isBusy = isBusy; };
  updateAdBotQueue (botId, data) {
    const botIndex = this.adBotsQueue.findIndex(bot => bot.id === botId);
    if (botIndex !== -1) {
      this.adBotsQueue[botIndex] = { ...this.adBotsQueue[botIndex], ...data };
    }
  }

  updateChannelUser (userId, timer) {
    return updateChannelUserFn(this, userId, timer);
  };

  updateChannelUserTimer (userId, newTimer) {
    if (this.channelUsers.has(userId)) {
      this.channelUsers.set(userId, { timer: newTimer });
    }
  }

  removeChannelUserFromQueue (userId) {
    this.channelUsersToMessageQueue.delete(userId);
  }

  updateAdsCount () {
    this.channelsAdsSent = this.channelsAdsSent + 1;
  }

  setMessagesDeliveredTo (userIds) {
    userIds.forEach(userId => this.messagesDeliverdeTo.add(userId));
  }

  setChannels (channels) {
    channels.forEach(channel => {
      this.channels.set(channel, channel);
    });
  }

  addNewRoomBotToken (token) {
    this.roomBotsTokens.push(token);
  }

  updateMainBotCounter (val) {
    this.mainBotReconnectTimer = val;
    // Restart scheduler when the timer is updated
    try {
      stopMainBotReconnectSchedulerFn(this);
      startMainBotReconnectSchedulerFn(this);
    } catch (e) { }
  }

  updateRoomBotsCounter (val) {
    this.roomBotsReconnectTimer = val;
  }

  updateAdBotsCounter (val) {
    this.adBotsReconnectTimer = val;
  }

  // Start/stop main bot reconnect scheduler (delegates to methods)
  startMainBotReconnectScheduler () { return startMainBotReconnectSchedulerFn(this); }
  stopMainBotReconnectScheduler () { return stopMainBotReconnectSchedulerFn(this); }
  async _runMainBotReconnect () { return runMainBotReconnectFn(this); }

  // Start/stop room bots reconnect scheduler
  startRoomBotsReconnectScheduler () { return startGroupReconnectSchedulerFn(this, 'room'); }
  stopRoomBotsReconnectScheduler () { return stopGroupReconnectSchedulerFn(this, 'room'); }
  async _runGroupReconnect (type) { return runGroupReconnectFn(this, type); }

  // Start/stop ad bots reconnect scheduler
  startAdBotsReconnectScheduler () { return startGroupReconnectSchedulerFn(this, 'ad'); }
  stopAdBotsReconnectScheduler () { return stopGroupReconnectSchedulerFn(this, 'ad'); }

  // Checkers for remaining time on group schedulers
  isRoomBotsTimerLessThanOneMinute () {
    try {
      // timer stored as milliseconds. Check if less than 60,000 ms (1 minute).
      if (typeof this.roomBotsReconnectTimer === 'number') { return this.roomBotsReconnectTimer < 60000; }
    } catch (e) { }
    return false;
  }

  isAdBotsTimerLessThanOneMinute () {
    try {
      if (typeof this.adBotsReconnectTimer === 'number') { return this.adBotsReconnectTimer < 60000; }
    } catch (e) { }
    return false;
  }

  // clear state
  clearUsers () { this.clearClassificationState(); }
  clearChannels () { this.channels.clear(); }
  clearMessages () { this.messages.clear(); }
  clearAdBotsTokens () { this.config.adBotConfig = this.config.adBotConfig.map((obj) => ({ ...obj, token: '' })); }

  clearConfig () {
    this.config.roomBotConfig.token = [];
    this.config.baseConfig.autoRun = false;
    this.clearAdBotsTokens();
  }

  // removed stored messages API
  async clearAdBots () {
    const bots = this.adBots;
    this.adBots = [];
    await Promise.allSettled(bots.map(bot => bot.disconnect()));
  }

  async clearRoomBots () {
    const bots = this.roomBots;
    this.roomBots = [];
    await Promise.allSettled(bots.map(bot => bot.disconnect()));
  }

  async clearForDisconnectState () {
    if (this._disconnectCleanupPromise) { return this._disconnectCleanupPromise; }
    this._destroyed = true;
    this.isReseting = true;
    this.cancelClassification();
    this.messageCount = 0;
    this.messages.clear();
    this._disconnectCleanupPromise = (async () => {
      await Promise.allSettled([
        this.mainBot?.disconnect(),
        this.clearRoomBots(),
        this.clearAdBots()
      ].filter(Boolean));
      await this.clearState({ terminal: true });
    })();
    return this._disconnectCleanupPromise;
  }

  async clearState ({ terminal = false } = {}) {
    this.isReseting = true;
    this.cancelClassification();
    this.clearClassificationState();
    await this.clearRoomBots();
    await this.clearAdBots();
    this.messagesDeliverdeTo.clear();
    this.currentStep = 1;
    this.lastUserIndex = 0;
    this.channels.clear();
    this.channelUsers.clear();
    this.channelsAdsSent = 0;
    this.roomBotsTokens = [];
    this.adBotsQueue = [];
    this.channelUsersToMessageQueue.clear();
    this.clearConfig();
    this.isPreparing = false;
    this._activePreparationGeneration = null;
    this.isBusy = false;
    this.isReseting = false;
    if (!terminal) { this._disconnectCleanupPromise = null; }
  }

  async resetState () {
    // Stop any scheduled reconnects
    // try { this.stopMainBotReconnectScheduler(); } catch (e) { }
    // try { this.stopRoomBotsReconnectScheduler(); } catch (e) { }
    // try { this.stopAdBotsReconnectScheduler(); } catch (e) { }

    // Clear scheduler trigger timestamps if present
    // try { this.mainBotSchedulerTriggerAt = null; } catch (e) { }
    // try { this.roomBotsSchedulerTriggerAt = null; } catch (e) { }
    // try { this.adBotsSchedulerTriggerAt = null; } catch (e) { }

    // Clear any raw scheduler refs
    // try { if (this._mainBotSchedulerRef) { clearTimeout(this._mainBotSchedulerRef); this._mainBotSchedulerRef = null; } } catch (e) { }
    // try { if (this._roomBotsSchedulerRef) { clearTimeout(this._roomBotsSchedulerRef); this._roomBotsSchedulerRef = null; } } catch (e) { }
    // try { if (this._adBotsSchedulerRef) { clearTimeout(this._adBotsSchedulerRef); this._adBotsSchedulerRef = null; } } catch (e) { }

    // Disconnect and remove bot instances
    // try { if (this.mainBot && typeof this.mainBot.disconnect === 'function') { this.mainBot.disconnect(); } } catch (e) { }
    await this.clearState();
    this.messageCount = 0;
    this.messages.clear();
    this.messagesDeliverdeTo.clear();

    // Null out references to help GC
    // try { this.socket = null; } catch (e) { }
    // try { this.config = null; } catch (e) { }
    // this.mainBot = null;
    this.currentStep = 1;
    this.roomBots = [];
    this.adBots = [];
    this.adBotsQueue = [];
    this.channelUsersToMessageQueue.clear();
    this.roomBotsTokens = [];
    this.config.adBotConfig = this.config.adBotConfig.map((obj) => ({ ...obj, token: '' }));
    // A command reset keeps the manager, main bot and control socket reusable.
  }

  // getState
  getState () {
    return getStateFn(this);
  }

  listAllBots () {
    return listAllBotsFn(this);
  }

  isRoomBotLimitValid () {
    return !(this.channels.size > this.config.baseConfig.instanceLimit);
  }

  // Remove a bot instance
  removeBot (botType, botInstance) {
    if (botType === 'main' && this.mainBot === botInstance) {
      this.mainBot = null;
    } else if (botType === 'room') {
      this.roomBots = this.roomBots.filter(bot => bot !== botInstance);
    } else if (botType === 'ad') {
      this.adBots = this.adBots.filter(bot => bot !== botInstance);
    }
  }
}

export default BotStateManager;
