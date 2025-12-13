import { updateEvents } from '../constants/updateEvents.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';
import { sendUpdateEvent } from '../updates/sendUpdateEvent.js';

function waitMilliseconds (milliseconds) {
  if (milliseconds <= 0) {
    return Promise.resolve();
  }
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

const hasLink = (string) => {
  const urlPattern = /https?:\/\/[^\s]+|www\.[^\s]+|\[.+?\]\(.+?\)/g;
  return urlPattern.test(string);
};

function extractAdBotPatchState (botManager) {
  return {
    // messages: callers should use botManager.getMessages() — messages are built per-send
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
async function sendPatchMessages (botManager) {
  const messages = botManager.getMessages();
  if (!Array.isArray(messages) || !messages.length) {
    throw new Error('No messages to send');
  }
  const waitTimeMilliseconds = botManager.getMessageCount() === 1
    ? botManager.config.baseConfig.singleMessageMillisecInterval || 0
    : botManager.getMessageCount() === 3
      ? botManager.config.baseConfig.multiMessageMillisecInterval || 0
      : 0;
  console.log('🚀 ~ sendPatchMessages ~ waitTimeMilliseconds:', waitTimeMilliseconds);

  const accountsWaitTime = botManager.config.baseConfig.accountsMillisecInterval || 0;
  console.log('🚀 ~ sendPatchMessages ~ accountsWaitTime:', accountsWaitTime);

  const betweenMessagesMillisecInterval = botManager.config.baseConfig.betweenMessagesMillisecInterval || 0;
  console.log('🚀 ~ sendPatchMessages ~ betweenMessagesMillisecInterval:', betweenMessagesMillisecInterval);

  const {
    adBots,
    messageCount,
    users,
    messagesDeliveredTo,
    lastUserIndex,
    setMessagesDeliveredTo,
    setLastUserIndex
  } = extractAdBotPatchState(botManager);

  let currentIndex = lastUserIndex;
  const patchSize = adBots.length;

  try {
    while (currentIndex < users.length) {
      if (!botManager.getUsers().length) {
        currentIndex = users.length + 1;
        return;
      }
      const patchUsers = users.slice(currentIndex, currentIndex + patchSize);
      if (messageCount === 1) {
        // Each bot sends one message to one user
        for (let i = 0; i < patchUsers.length; i++) {
          const userId = patchUsers[i];
          const bot = adBots[i];
          bot.setIsWorking(true);
          if (bot) {
            sendUpdateEvent(botManager, updateEvents.ad.update, {
              adsSent: currentIndex + i + 1
            });
            setLastUserIndex(currentIndex + i);
            setMessagesDeliveredTo([
              ...messagesDeliveredTo,
              userId
            ]);
            const message = messages[0];
            sendPrivateMessage(userId, message, bot);
            // if (hasLink(text)) {
            //   const res = await sendPrivateMessage(userId, text, bot);
            //   console.log('🚀 ~ sendPatchMessages ~ res:', res);
            // } else {
            //   sendPrivateMessage(userId, text, bot);
            // }

            await waitMilliseconds(accountsWaitTime);
          }
        }

        currentIndex += patchSize;
        await waitMilliseconds(waitTimeMilliseconds);
        if (botManager.isAdBotsTimerLessThanOneMinute()) {
          adBots.forEach(bot => {
            bot.setIsBusy(true);
            bot.setIsWorking(false);
          });
        }
      } else if (messageCount === 3) {
        // Each bot sends three messages to each user in the patch
        for (let i = 0; i < patchUsers.length; i++) {
          const userId = patchUsers[i];
          const bot = adBots[i];
          bot.setIsWorking(true);
          if (bot) {
            for (let m = 0; m < Math.min(3, messages.length); m++) {
              const message = messages[m];
              if (!message) {
                console.warn('No message text for index', m);
                continue;
              }
              sendPrivateMessage(userId, message, bot);
              // if (hasLink(text)) {
              //   const res = await sendPrivateMessage(userId, text, bot);
              //   console.log('🚀 ~ sendPatchMessages ~ res:', res);
              // } else {
              //   await sendPrivateMessage(userId, text, bot);
              // }
              if (m !== 2) {
                await waitMilliseconds(betweenMessagesMillisecInterval);
              }
            }
            await waitMilliseconds(accountsWaitTime);
          }
          setMessagesDeliveredTo([
            ...messagesDeliveredTo,
            userId
          ]);
          setLastUserIndex(currentIndex + i);
          sendUpdateEvent(botManager, updateEvents.ad.update, {
            adsSent: currentIndex + i + 1
          });
        }
        currentIndex += patchSize;

        await waitMilliseconds(waitTimeMilliseconds);
        if (botManager.isAdBotsTimerLessThanOneMinute()) {
          adBots.forEach(bot => {
            bot.setIsBusy(true);
            bot.setIsWorking(false);
          });
        }
      } else {
        throw new Error('Unsupported message count. Only 1 or 3 are allowed.');
      }
    }
  } catch (error) {
    console.error('Error sending patch messages:', error);
    await sendPrivateMessage(botManager.config.baseConfig.orderFrom, error.message, botManager.getMainBot());
  } finally {
    await botManager.clearAdBots();
  }
}

// Export the function for use
export { sendPatchMessages };
