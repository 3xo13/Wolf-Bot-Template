import { updateEvents } from '../constants/updateEvents.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';
import { sendUpdateEvent } from '../updates/sendUpdateEvent.js';

function waitMilliseconds (milliseconds) {
  if (milliseconds <= 0) {
    return Promise.resolve();
  }
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

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
  const waitTimeMilliseconds = botManager.getMessageCount() === 1
    ? botManager.config.baseConfig.singleMessageMillisecInterval || 0
    : botManager.getMessageCount() === 3
      ? botManager.config.baseConfig.multiMessageMillisecInterval || 0
      : 0;

  const accountsWaitTime = botManager.config.baseConfig.accountsMillisecInterval || 0;

  const betweenMessagesMillisecInterval = botManager.config.baseConfig.betweenMessagesMillisecInterval || 0;

  const {
    adBots,
    messageCount,
    users,
    messagesDeliveredTo,
    lastUserIndex,
    setMessagesDeliveredTo,
    setLastUserIndex
  } = extractAdBotPatchState(botManager);

  const messages = botManager.getMessages();

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
            // Build-on-send: take the first configured message text and build per-recipient
            const text = Array.isArray(messages) && messages.length > 0 ? messages[0] : undefined;
            if (!text) {
              console.warn('No message text found for sending to user', userId);
            } else {
              try {
                await sendPrivateMessage(userId, text, bot);
              } catch (e) {
                console.error('Error sending built message for user', userId, e);
              }
            }
            await waitMilliseconds(accountsWaitTime);
            bot.setIsBusy(true);
            bot.setIsWorking(false);
          }
        }

        currentIndex += patchSize;
        await waitMilliseconds(waitTimeMilliseconds);
      } else if (messageCount === 3) {
        // Each bot sends three messages to each user in the patch
        for (let i = 0; i < patchUsers.length; i++) {
          const userId = patchUsers[i];
          const bot = adBots[i];
          bot.setIsWorking(true);
          if (bot) {
            for (let m = 0; m < Math.min(3, messages.length); m++) {
              const text = messages[m];
              if (!text) {
                console.warn('No message text for index', m);
                continue;
              }
              try {
                await sendPrivateMessage(userId, text, bot, null, bot);
              } catch (e) {
                console.error('Error sending built message for user', userId, 'index', m, e);
              }
              if (m !== 2) {
                await waitMilliseconds(betweenMessagesMillisecInterval);
              }
            }
            await waitMilliseconds(accountsWaitTime);
            bot.setIsBusy(true);
            bot.setIsWorking(false);
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
