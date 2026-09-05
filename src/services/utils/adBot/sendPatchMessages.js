import { updateEvents } from '../constants/updateEvents.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';
import { sendUpdateEvent } from '../updates/sendUpdateEvent.js';
import {
  getConnectedAdBots,
  isAdCampaignActive,
  waitForConnectedAdBot
} from './campaignAvailability.js';

function waitMilliseconds (milliseconds) {
  return milliseconds > 0
    ? new Promise(resolve => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}

function recordMemberDispatch (botManager, userId, nextIndex) {
  botManager.setLastUserIndex(nextIndex);
  botManager.setMessagesDeliveredTo([userId]);
  sendUpdateEvent(botManager, updateEvents.ad.update, { adsSent: nextIndex });
}

async function sendPatchMessages (botManager, campaignGeneration) {
  const classificationGeneration = botManager._classificationGeneration;
  const messages = botManager.getMessages();
  if (!messages.length) { throw new Error('No messages to send'); }

  const messageCount = botManager.getMessageCount();
  const patchInterval = messageCount === 1
    ? botManager.config.baseConfig.singleMessageMillisecInterval || 0
    : messageCount === 3
      ? botManager.config.baseConfig.multiMessageMillisecInterval || 0
      : 0;
  const accountInterval = botManager.config.baseConfig.accountsMillisecInterval || 0;
  const messageInterval = botManager.config.baseConfig.betweenMessagesMillisecInterval || 0;
  let currentIndex = botManager.getLastUserIndex();

  try {
    while (!botManager.isClassificationCancelled(classificationGeneration) &&
      isAdCampaignActive(botManager, campaignGeneration)) {
      const users = botManager.getUsers();
      if (currentIndex >= users.length) {
        if (botManager.hasPendingClassification()) {
          await botManager.waitForRecipientChange(1000);
          continue;
        }
        break;
      }

      if (!getConnectedAdBots(botManager).length) {
        if (!await waitForConnectedAdBot(botManager, campaignGeneration)) { return 'cancelled'; }
        continue;
      }
      const availableBots = getConnectedAdBots(botManager, { availableOnly: true });
      if (!availableBots.length) {
        await waitMilliseconds(100);
        continue;
      }

      let sentInPatch = 0;
      const usedBots = [];
      for (const bot of availableBots) {
        if (currentIndex >= users.length || !isAdCampaignActive(botManager, campaignGeneration)) { break; }
        if (!bot.connected || bot.isBusy || bot.isWorking) { continue; }

        const userId = users[currentIndex];
        let dispatched = false;
        bot.setIsWorking(true);
        usedBots.push(bot);

        if (messageCount === 1 && messages[0]) {
          currentIndex++;
          dispatched = true;
          recordMemberDispatch(botManager, userId, currentIndex);
          sendPrivateMessage(userId, messages[0], bot).catch(() => {});
        } else if (messageCount === 3) {
          for (const message of messages.slice(0, 3)) {
            if (!bot.connected || !isAdCampaignActive(botManager, campaignGeneration)) { break; }
            if (!message) { continue; }
            if (!dispatched) {
              currentIndex++;
              dispatched = true;
              recordMemberDispatch(botManager, userId, currentIndex);
            }
            sendPrivateMessage(userId, message, bot).catch(() => {});
            await waitMilliseconds(messageInterval);
          }
        } else {
          throw new Error('Unsupported message count. Only 1 or 3 are allowed.');
        }

        if (dispatched) {
          sentInPatch++;
          await waitMilliseconds(accountInterval);
        }
        bot.setIsWorking(false);
      }

      usedBots.forEach(bot => bot.setIsWorking(false));
      if (!sentInPatch) { continue; }
      await waitMilliseconds(patchInterval);
      if (botManager.isAdBotsTimerLessThanOneMinute()) {
        usedBots.forEach(bot => bot.setIsBusy(true));
      }
    }

    return isAdCampaignActive(botManager, campaignGeneration) ? 'completed' : 'cancelled';
  } catch (error) {
    if (botManager.isClassificationCancelled(classificationGeneration)) { return 'cancelled'; }
    console.error('Error sending patch messages:', error);
    await sendPrivateMessage(
      botManager.config.baseConfig.orderFrom,
      error.message,
      botManager.getMainBot()
    );
    return 'cancelled';
  }
}

export { sendPatchMessages };
