import { sendPatchMessages } from '../adBot/magic/sendPatchMessages.js';
import { updateEvents } from '../constants/updateEvents.js';
import { sendUpdateEvent } from '../updates/sendUpdateEvent.js';

async function rotateOnce (botManager) {
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
  const usersPatch = [];
  let userIndex = 0;
  for (const bot of availableBots) {
    let user = null;
    while (userIndex < channelUsers.length && !user) {
      const candidate = channelUsers[userIndex++];
      const existingTimer = Number(botManager.channelUsers.get(candidate.userId)?.timer) || 0;
      if (existingTimer > Date.now()) {
        // A previously reserved member may still have a stale queue entry. Do
        // not let that entry bypass the active grace period.
        botManager.removeChannelUserFromQueue(candidate.userId);
      } else {
        user = candidate;
      }
    }
    if (!user) { break; }

    // Reserve the member before yielding to the asynchronous sender. Activity
    // received while the rest of this patch is being processed must observe
    // the grace period and must not enqueue the member a second time.
    const graceMinutes = Number(botManager.getChannelMessagingTimer());
    const graceMilliseconds = Number.isFinite(graceMinutes) && graceMinutes > 0
      ? graceMinutes * 60 * 1000
      : 0;
    botManager.updateChannelUserTimer(user.userId, Date.now() + graceMilliseconds);
    botManager.removeChannelUserFromQueue(user.userId);
    botManager.updateAdBotQueue(bot.id, { sending: true });
    bot.bot.setIsWorking(true);
    usersPatch.push({ bot, user });
  }
  if (usersPatch.length) { await sendPatchMessages(botManager, usersPatch); }
  return usersPatch.length;
}

export function scheduleMagicRotation (botManager) {
  if (botManager.magicRotationPromise) { return botManager.magicRotationPromise; }
  const task = (async () => {
    while (!botManager.isReseting && botManager.channelUsersToMessageQueue.size) {
      const sent = await rotateOnce(botManager);
      if (!sent) { break; }
    }
  })();
  const trackedTask = task.catch(error => {
    console.error('Magic messaging rotation failed:', error);
  }).finally(() => {
    if (botManager.magicRotationPromise === trackedTask) { botManager.magicRotationPromise = null; }
  });
  botManager.magicRotationPromise = trackedTask;
  return trackedTask;
}

export async function queueEligibleActivities (botManager, userIds) {
  const queuedAt = Date.now();
  for (const userId of userIds) {
    const id = String(userId);
    botManager.pendingMagicActivities.delete(id);
    botManager.updateChannelUser(id, queuedAt);
  }
  await sendUpdateEvent(botManager, updateEvents.users.setup, { users: botManager.getUsers().length });
  // Messaging owns its own serialized rotation. Classification only publishes
  // eligible members and must not wait for advertising delays to finish.
  scheduleMagicRotation(botManager);
}

export async function queueEligibleActivity (botManager, userId) {
  await queueEligibleActivities(botManager, [userId]);
}
