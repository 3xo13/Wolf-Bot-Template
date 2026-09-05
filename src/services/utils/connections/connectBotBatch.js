import { userMessages } from '../constants/userMessages.js';

export const CONNECTION_BATCH_BUSY = 'CONNECTION_BATCH_BUSY';
export const CONNECTION_BATCH_FAILED = 'CONNECTION_BATCH_FAILED';

export function assertConnectionBatchAvailable (botManager, botType) {
  if (botManager._connectionBatches?.[botType]) {
    const error = new Error(userMessages.connectionBatchInProgress);
    error.code = CONNECTION_BATCH_BUSY;
    throw error;
  }
}

export async function connectBotBatch (botManager, {
  botType,
  count,
  adBotIndex
}) {
  if (!['room', 'ad'].includes(botType)) {
    throw new Error(`Unsupported connection batch type: ${botType}`);
  }
  botManager._connectionBatches ||= { room: null, ad: null };
  assertConnectionBatchAvailable(botManager, botType);

  let invalidated = false;
  const task = (async () => {
    const attempts = Array.from({ length: Math.max(0, count) }, async () => {
      try {
        return await botManager.connect(botType, adBotIndex);
      } catch (error) {
        if (!invalidated) {
          invalidated = true;
          if (typeof botManager.invalidateConnectionAttempts === 'function') {
            botManager.invalidateConnectionAttempts(botType);
          }
        }
        throw error;
      }
    });
    const results = await Promise.allSettled(attempts);
    const connectedBots = results
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value);
    const rejected = results.filter(result => result.status === 'rejected');
    const failed = rejected.find(result => result.reason?.code !== 'BOT_CONNECTION_CANCELLED') || rejected[0];

    if (failed) {
      if (botType === 'room') {
        if (typeof botManager.clearRoomBots === 'function') {
          await botManager.clearRoomBots(connectedBots);
        } else {
          await Promise.allSettled(connectedBots.map(bot => bot.disconnect?.()));
        }
      } else {
        const connectedSet = new Set(connectedBots);
        if (Array.isArray(botManager.adBots)) {
          botManager.adBots = botManager.adBots.filter(bot => !connectedSet.has(bot));
        }
        await Promise.allSettled(connectedBots.map(bot => bot.disconnect()));
      }
      const failure = failed.reason instanceof Error
        ? failed.reason
        : new Error(String(failed.reason));
      if (botManager.isReseting) { throw failure; }
      const error = new Error(failure.message, { cause: failure });
      error.code = CONNECTION_BATCH_FAILED;
      throw error;
    }

    return connectedBots;
  })();

  botManager._connectionBatches[botType] = task;
  try {
    return await task;
  } finally {
    if (botManager._connectionBatches[botType] === task) {
      botManager._connectionBatches[botType] = null;
    }
  }
}
