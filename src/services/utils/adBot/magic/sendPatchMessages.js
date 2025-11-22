import { updateEvents } from '../../constants/updateEvents.js';
import { sendPrivateMessage } from '../../messaging/sendPrivateMessage.js';
import { sendUpdateEvent } from '../../updates/sendUpdateEvent.js';

function waitSeconds (seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

function waitMilliseconds (milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function extractAdBotPatchState (botManager) {
  return {
    messages: botManager.getMessages(),
    adBots: botManager.getAdBots(),
    messageCount: botManager.getMessageCount(),
    users: botManager.getUsers(),
    messagesDeliveredTo: botManager.getMessagesDeliveredTo(),
    lastUserIndex: botManager.getLastUserIndex(),
    setMessagesDeliveredTo: arr => botManager.setMessagesDeliveredTo(arr),
    setLastUserIndex: idx => botManager.setLastUserIndex(idx),
    setMessageCount: count => botManager.setMessageCount(count)
  };
}
async function sendPatchMessages (botManager, patch) {
  // console.log("🚀 ~ sendPatchMessages ~ patch:", patch)
  const waitTimeMilliseconds = botManager.getMessageCount() === 1 ? botManager.config.baseConfig.singleMessageMillisecInterval || 4000 : botManager.getMessageCount() === 3 ? botManager.config.baseConfig.multiMessageMillisecInterval || 9000 : 3000;
  const accountsWaitTime = botManager.config.baseConfig.accountsMillisecInterval || 100;
  const {
    messages,
    messageCount,
    messagesDeliveredTo,
    setLastUserIndex
  } = extractAdBotPatchState(botManager);

  try {
    // loop over the patch and send a message to the user from the bot and update the bot in queue
    for (let index = 0; index < patch.length; index++) {
      const { user: { userId }, bot } = patch[index];
      if (!botManager.getChannelUsers().length) {
        index = patch.length + 1;
        return;
      }
      if (messageCount === 1) {
        // Each bot sends one message to one user
        if (bot && messages[0]) {
          const timer = new Date();
          const minutesTimer = botManager.getChannelMessagingTimer();
          timer.setMinutes(timer.getMinutes() + minutesTimer);

          botManager.updateChannelUserTimer(userId, timer.getTime());

          await sendPrivateMessage(userId, messages[0], bot.bot);
          botManager.updateAdsCount();
          sendUpdateEvent(botManager, updateEvents.ad.update, { adsSent: botManager.channelsAdsSent });
          await waitMilliseconds(accountsWaitTime);
        }

        if (index === patch.length - 1) {
          await waitMilliseconds(waitTimeMilliseconds);
        }
      } else if (messageCount === 3) {
        // Each bot sends three messages to each user in the patch
        if (bot && messages.length > 0) {
          for (let m = 0; m < messages.slice(0, 3).length; m++) {
            const message = messages[m];
            await sendPrivateMessage(userId, message, bot.bot);
            await waitMilliseconds(100);
          }
          await waitMilliseconds(accountsWaitTime);

          const timer = new Date();
          const minutesTimer = botManager.getChannelMessagingTimer();
          timer.setMinutes(timer.getMinutes() + minutesTimer);
          botManager.updateChannelUserTimer(userId, timer.getTime());
          botManager.updateAdsCount();
          // setLastUserIndex(currentIndex + i);
          sendUpdateEvent(botManager, updateEvents.ad.update, { adsSent: botManager.channelsAdsSent });
        }
        if (index === patch.length - 1) {
          await waitMilliseconds(waitTimeMilliseconds);
        }
      } else {
        throw new Error('Unsupported message count. Only 1 or 3 are allowed.');
      }
    }
    console.log('🚀 ~ freeing bots...');
    patch.forEach(item => {
      if (botManager.isAdBotsTimerLessThanOneMinute()) {
        item.bot.bot.setIsBusy(true);
      }
      item.bot.bot.setIsWorking(false);
      botManager.updateAdBotQueue(item.bot.id, { sending: false, lastUse: Date.now() });
    });
  } catch (error) {
    console.error('Error sending patch messages:', error);
    console.log('🚀 ~ freeing bots...');
    patch.forEach(item => {
      botManager.updateAdBotQueue(item.bot.id, { sending: false, lastUse: Date.now() });
    });
    await sendPrivateMessage(botManager.config.baseConfig.orderFrom, error.message, botManager.getMainBot());
  }
}

// Export the function for use
export { sendPatchMessages };
