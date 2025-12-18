import { sendPatchMessages } from '../../adBot/magic/sendPatchMessages.js';
import { magicBotSteps } from '../../constants/magicBotSteps.js';
import { updateEvents } from '../../constants/updateEvents.js';
import { sendUpdateEvent } from '../../updates/sendUpdateEvent.js';

function getRandomIndex (num) {
  if (num <= 0) { return null; } // or throw an error
  return Math.floor(Math.random() * num);
}

async function handleBotRotation (botManager) {
  const adBots = botManager.getAdBots();
  const adBotsQueue = botManager.adBotsQueue;
  const channelUsers = botManager.getChannelUsersToMessageQueue();

  // sets initial ad bot objects on first message
  if (adBots.length > adBotsQueue.length) {
    adBots.forEach((bot, i) => {
      if (adBotsQueue.find(bot => bot.id === i)) {
        return;
      }
      botManager.addAdBotToQueue({ bot, id: i, lastUse: Date.now(), sending: false });
    });
  }

  // create a patch of bots and users to message if the bots in the queue was
  const availableBots = botManager.adBotsQueue.map(bot => {
    const isAvailable = bot.sending === false && (Date.now()) >= (bot.lastUse) && !bot.isWorking && !bot.isBusy;
    if (botManager.isAdBotsTimerLessThanOneMinute() && isAvailable) {
      try { bot.bot.setIsBusy(true); } catch (e) { }
      return null;
    }
    return isAvailable ? bot : null;
  }).filter(bot => bot !== null);

  const usersPatch = availableBots.map((bot, index) => {
    const user = channelUsers[index];
    if (user) {
      botManager.removeChannelUserFromQueue(user.userId);
      botManager.updateAdBotQueue(bot.id, { sending: true });
      bot.bot.setIsWorking(true);
      return { bot, user };
    }
    return null;
  }).filter(item => item !== null);

  await sendPatchMessages(botManager, usersPatch);
}

export const handleGroupMessage = async (botManager, channelMessage) => {
  try {
    if (botManager.getCurrentStep() !== magicBotSteps.messaging.stepNumber) {
      return;
    }

    // Extract user ID from different possible message properties
    const userId = channelMessage.originator?.id ||
      channelMessage.sourceSubscriberId ||
      channelMessage.subscriber?.id ||
      channelMessage.subscriberId ||
      channelMessage.occupierId; // For audio slot updates

    if (!userId) {
      // For audio count updates or other events without user IDs, skip silently
      return;
    }

    // Ignore messages from bots themselves
    const roomBotIds = botManager.getRoomBots().map(bot => bot.currentSubscriber?.id).filter(Boolean);
    const adBotIds = botManager.getAdBots().map(bot => bot.currentSubscriber?.id).filter(Boolean);

    if (roomBotIds.includes(userId) || adBotIds.includes(userId)) {
      return; // Ignore messages from our own bots
    }

    const adBots = botManager.getAdBots();

    const randomAdBotIndex = getRandomIndex(adBots.length);
    if (!randomAdBotIndex && randomAdBotIndex !== 0) {
      return;
    }

    const isPrivileged = await adBots[randomAdBotIndex].utility.subscriber.privilege.has(
      userId,
      [512, 4096, 16384, 16777216, 33554432, 2, 536870912]
    );
    if (botManager.config.baseConfig.excludeAdmins && isPrivileged) {
      return;
    }

    const timer = Date.now();
    botManager.updateChannelUser(userId, timer);
    await sendUpdateEvent(botManager, updateEvents.users.setup, { users: botManager.getChannelUsers().length });

    await handleBotRotation(botManager);
  } catch (error) {
    console.error('Error in handleGroupMessage:', error);
  }
};
