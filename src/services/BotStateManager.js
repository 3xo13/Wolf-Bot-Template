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

class BotStateManager {
  constructor (config) {
    this.config = config;
    this.mainBot = null; // Main bot instance
    this.roomBots = []; // Array of room bot instances
    this.adBots = []; // Array of ad bot instances
    this.users = new Set(); // Set of unique user IDs
    this.messagesDeliverdeTo = new Set(); // Set of user IDs to whom messages have been delivered
    this.lastUserIndex = 0;
    this.channels = new Map(); // Map of channelId -> channel info
    this.socket = null; // Socket connection instance
    this.currentStep = 1; // Current step in the process
    this.messages = new Set(); // Message texts for display
    this.messageCount = 0;
    this.channelUsers = new Map();
    this.channelUsersToMessageQueue = [];
    this.adBotsQueue = [];
    this.channelsAdsSent = 0;
    this.roomBotsTokens = [];
    this.isBusy = false;
    this.mainBotReconnectTimer = null;
    this.roomBotsReconnectTimer = null;
    this.adBotsReconnectTimer = null;
    this._mainBotSchedulerRef = null;
    this.lastStep = 0;
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
  async connect (botType) { return connectFn(this, botType); }

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
  setRoomBotToken (token) { this.config.roomBotConfig.token = token; };
  setAdBotToken (token) { this.config.adBotConfig.token = token; };
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
    this.channelUsersToMessageQueue = this.channelUsersToMessageQueue.filter(item => item.userId !== userId);
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
  clearUsers () { this.users.clear(); }
  clearChannels () { this.channels.clear(); }
  clearMessages () { this.messages.clear(); }
  // removed stored messages API
  clearAdBots () {
    this.adBots.forEach(bot => bot.disconnect());
    this.adBots = [];
  }

  clearRoomBots () {
    this.roomBots.forEach(bot => bot.disconnect());
    this.roomBots = [];
  }

  clearForDisconnectState () {
    this.clearState();
    this.messageCount = 0;
    this.messages.clear();
    this.mainBot?.disconnect();
    this.resetState();
  }

  clearState () {
    this.messagesDeliverdeTo.clear();
    this.clearRoomBots();
    this.clearAdBots();
    this.currentStep = 1;
    this.users.clear();
    this.lastUserIndex = 0;
    this.channels.clear();
    this.channelUsers.clear();
    this.channelsAdsSent = 0;
    this.roomBotsTokens = [];
    this.adBotsQueue = [];
    this.channelUsersToMessageQueue = [];
  }

  resetState () {
    // Stop any scheduled reconnects
    // try { this.stopMainBotReconnectScheduler(); } catch (e) { }
    try { this.stopRoomBotsReconnectScheduler(); } catch (e) { }
    try { this.stopAdBotsReconnectScheduler(); } catch (e) { }

    // Clear scheduler trigger timestamps if present
    // try { this.mainBotSchedulerTriggerAt = null; } catch (e) { }
    try { this.roomBotsSchedulerTriggerAt = null; } catch (e) { }
    try { this.adBotsSchedulerTriggerAt = null; } catch (e) { }

    // Clear any raw scheduler refs
    // try { if (this._mainBotSchedulerRef) { clearTimeout(this._mainBotSchedulerRef); this._mainBotSchedulerRef = null; } } catch (e) { }
    try { if (this._roomBotsSchedulerRef) { clearTimeout(this._roomBotsSchedulerRef); this._roomBotsSchedulerRef = null; } } catch (e) { }
    try { if (this._adBotsSchedulerRef) { clearTimeout(this._adBotsSchedulerRef); this._adBotsSchedulerRef = null; } } catch (e) { }

    // Disconnect and remove bot instances
    // try { if (this.mainBot && typeof this.mainBot.disconnect === 'function') { this.mainBot.disconnect(); } } catch (e) { }
    try { this.roomBots.forEach(bot => { try { if (bot && typeof bot.disconnect === 'function') { bot.disconnect(); } } catch (e) { } }); } catch (e) { }
    try { this.adBots.forEach(bot => { try { if (bot && typeof bot.disconnect === 'function') { bot.disconnect(); } } catch (e) { } }); } catch (e) { }

    // Clear internal collections and state
    try { this.clearState(); } catch (e) { }
    this.messageCount = 0;
    try { this.messages.clear(); } catch (e) { }

    try { this.messagesDeliverdeTo.clear(); } catch (e) { }

    // Null out references to help GC
    // try { this.socket = null; } catch (e) { }
    // try { this.config = null; } catch (e) { }
    // this.mainBot = null;
    this.currentStep = 1;
    this.roomBots = [];
    this.adBots = [];
    this.adBotsQueue = [];
    this.channelUsersToMessageQueue = [];
    this.roomBotsTokens = [];

    // mark destroyed so future callbacks can no-op
    this._destroyed = true;
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
