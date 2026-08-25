import { sendPatchMessages } from '../../adBot/magic/sendPatchMessages.js';
import { magicBotSteps } from '../../constants/magicBotSteps.js';
import { updateEvents } from '../../constants/updateEvents.js';
import { sendUpdateEvent } from '../../updates/sendUpdateEvent.js';
import { classifySubscriberPatch } from '../../classification/classifySubscribers.js';

async function handleBotRotation (botManager) {
  const channelUsers = botManager.getChannelUsersToMessageQueue();
  if (botManager.getAdBots().length > botManager.adBotsQueue.length) {
    botManager.getAdBots().forEach((bot, id) => {
      if (!botManager.adBotsQueue.some(entry => entry.id === id)) {
        botManager.addAdBotToQueue({ bot, id, lastUse: Date.now(), sending: false });
      }
    });
  }
  const availableBots = botManager.adBotsQueue.filter(entry => {
    const available = !entry.sending && Date.now() >= entry.lastUse && !entry.bot.isWorking && !entry.bot.isBusy;
    if (botManager.isAdBotsTimerLessThanOneMinute() && available) {
      entry.bot.setIsBusy(true);
      return false;
    }
    return available;
  });
  const usersPatch = availableBots.map((bot, index) => {
    const user = channelUsers[index];
    if (!user) { return null; }
    botManager.removeChannelUserFromQueue(user.userId);
    botManager.updateAdBotQueue(bot.id, { sending: true });
    bot.bot.setIsWorking(true);
    return { bot, user };
  }).filter(Boolean);
  await sendPatchMessages(botManager, usersPatch);
}

async function queueEligibleActivity (botManager, userId) {
  botManager.updateChannelUser(userId, Date.now());
  await sendUpdateEvent(botManager, updateEvents.users.setup, { users: botManager.getChannelUsers().length });
  await handleBotRotation(botManager);
}

export const handleGroupMessage = async (botManager, channelMessage, sourceRoomBot) => {
  try {
    if (botManager.getCurrentStep() !== magicBotSteps.messaging.stepNumber) { return; }
    const rawId = channelMessage.originator?.id || channelMessage.sourceSubscriberId ||
      channelMessage.subscriber?.id || channelMessage.subscriberId || channelMessage.occupierId;
    if (!rawId) { return; }
    const userId = String(rawId);
    const ownIds = [...botManager.getRoomBots(), ...botManager.getAdBots()]
      .map(bot => String(bot.currentSubscriber?.id || ''));
    if (ownIds.includes(userId)) { return; }

    if (botManager.config.baseConfig.excludeAdmins && botManager.excludedUsers.has(userId)) { return; }
    if (botManager.channelUsers.has(userId)) {
      await queueEligibleActivity(botManager, userId);
      return;
    }
    if (!botManager.config.baseConfig.excludeAdmins) {
      botManager.classifyUser(userId, false);
      await queueEligibleActivity(botManager, userId);
      return;
    }

    const existing = botManager.magicClassificationPromises.get(userId);
    if (existing) {
      await existing;
      return;
    }
    if (botManager.unknownUsers.has(userId) && (botManager.magicUnknownRetryAt.get(userId) || 0) > Date.now()) { return; }

    const classification = (async () => {
      const result = await classifySubscriberPatch(botManager, sourceRoomBot, [userId], { attempts: 1 });
      if (result.cancelled) { return; }
      if (result.unknown.length) {
        botManager.magicUnknownRetryAt.set(userId, Date.now() + 10000);
        return;
      }
      if (result.eligible.length) { await queueEligibleActivity(botManager, userId); }
    })().finally(() => botManager.magicClassificationPromises.delete(userId));
    botManager.magicClassificationPromises.set(userId, classification);
    await classification;
  } catch (error) {
    console.error('Error in handleGroupMessage:', error);
  }
};
