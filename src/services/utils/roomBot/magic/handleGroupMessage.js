import { magicBotSteps } from '../../constants/magicBotSteps.js';
import { enqueueMagicCandidate } from '../../classification/classificationPool.js';
import { queueEligibleActivity } from '../../classification/magicQueue.js';

export const handleGroupMessage = async (botManager, channelMessage) => {
  try {
    if (botManager.getCurrentStep() !== magicBotSteps.messaging.stepNumber) { return; }
    const rawId = channelMessage.originator?.id || channelMessage.sourceSubscriberId ||
      channelMessage.subscriber?.id || channelMessage.subscriberId || channelMessage.occupierId;
    if (!rawId) { return; }
    const userId = String(rawId);
    const ownIds = [...botManager.getRoomBots(), ...botManager.getAdBots()]
      .map(bot => String(bot.currentSubscriber?.id || ''));
    if (ownIds.includes(userId)) { return; }

    if (botManager.excludedUsers.has(userId) || botManager.ignoredUsers.has(userId)) { return; }
    if (botManager.channelUsers.has(userId)) {
      await queueEligibleActivity(botManager, userId);
      return;
    }
    if (!botManager.config.baseConfig.excludeAdmins) {
      botManager.classifyUser(userId, false);
      await queueEligibleActivity(botManager, userId);
      return;
    }
    if (botManager.queuedUsers.has(userId) || botManager.classifyingUsers.has(userId) ||
      botManager.unknownUsers.has(userId) || botManager.pendingMagicActivities.has(userId)) {
      return;
    }
    if (botManager.eligibleUsers.has(userId)) {
      await queueEligibleActivity(botManager, userId);
      return;
    }

    await enqueueMagicCandidate(botManager, userId);
  } catch (error) {
    console.error('Error in handleGroupMessage:', error);
  }
};
