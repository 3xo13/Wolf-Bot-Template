import { adBotSteps } from '../constants/adBotSteps.js';
import { userMessages } from '../constants/userMessages.js';
import { updateEvents } from '../constants/updateEvents.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';
import setStepState from '../steps/setStepState.js';
import { sendUpdateEvent } from '../updates/sendUpdateEvent.js';
import { extractChannelMembers } from './getUsersIDs.js';
import { checkBotStep } from '../steps/checkBotStep.js';
import handleBotStepReplay from '../steps/handleBotStepReplay.js';
import {
  ensureClassificationBots,
  startClassificationWorkers,
  waitForClassificationWorkers
} from '../classification/classificationPool.js';
import { reportAutoClassification } from '../classification/unknownUsers.js';
import {
  assertRoomConnectionCooldownComplete,
  startRoomConnectionCooldown
} from './roomConnectionCooldown.js';

async function fetchOnly (botManager, roomBot, channelId, generation) {
  try {
    await extractChannelMembers(roomBot, botManager, channelId, generation);
  } finally {
    if (!botManager.isClassificationCancelled(generation)) {
      botManager.classificationProducers = Math.max(0, botManager.classificationProducers - 1);
    }
    botManager.signalRecipientChange();
  }
}

export async function releasePreparationRoomBots (botManager, producerBots, generation) {
  if (botManager.isClassificationCancelled(generation)) { return false; }
  // Only release the bots owned by this preparation run. A reset may already
  // have started a new session with different room bots in the manager.
  await botManager.clearRoomBots(producerBots);
  return true;
}

export async function connectPreparationRoomBots (botManager, count) {
  // Preserve the original parallel connection behavior. Waiting with
  // allSettled keeps partial failures safe without stretching the proxy load
  // into a long stream of new WebSocket handshakes.
  const results = await Promise.allSettled(
    Array.from({ length: count }, () => botManager.connect('room'))
  );
  return {
    bots: results
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value),
    error: results.find(result => result.status === 'rejected')?.reason || null
  };
}

export function getLowRoomClassificationWorkerCount (roomCount, userCount) {
  if (roomCount >= 3 || userCount <= 5000) { return 0; }
  return userCount < 50000 ? 3 : 5;
}

export const handlePrepareCommand = async (botManager) => {
  // Keep a failed pool's primary room bot intact while the remote sessions are
  // given time to close. This check must happen outside the cleanup catch.
  assertRoomConnectionCooldownComplete(botManager);
  botManager.setIsBusy(true);
  const mainBot = botManager.getMainBot();
  let generation = null;
  let producerBots = [];
  let additionalProducers = [];
  let roomPoolConnectionFailed = false;
  try {
    const initialRoomBot = botManager.getRoomBots()[0];
    if (!checkBotStep(botManager, 'room') || !initialRoomBot) {
      await handleBotStepReplay(botManager);
      return;
    }
    if (!initialRoomBot.connected || !initialRoomBot.currentSubscriber) {
      await initialRoomBot.disconnect();
      throw new Error('بوت الرومات غير متصل، يرجى تغيير الحساب');
    }

    botManager.isPreparing = true;
    botManager.clearClassificationState();
    generation = botManager._classificationGeneration;
    botManager._activePreparationGeneration = generation;
    await sendPrivateMessage(botManager.config.baseConfig.orderFrom, 'جاري التجهيز...', mainBot, mainBot);

    const channels = botManager.getChannels();
    const channelProfiles = await initialRoomBot.channel.list();
    const channelIds = new Set(channels.map(String));
    const estimatedUsers = channelProfiles
      .filter(channel => channelIds.has(String(channel.id)))
      .reduce((total, channel) => total + (Number(channel.membersCount) || 0), 0);
    producerBots = [initialRoomBot];
    const additionalConnections = await connectPreparationRoomBots(
      botManager,
      Math.max(0, channels.length - 1)
    );
    additionalProducers = additionalConnections.bots;
    producerBots.push(...additionalProducers);
    if (additionalConnections.error || producerBots.length !== channels.length) {
      roomPoolConnectionFailed = true;
      throw additionalConnections.error || new Error('تعذر تخصيص بوت واحد لكل غرفة');
    }

    await Promise.all(additionalProducers.map(bot => bot.channel.list().catch(error => {
      console.warn('Failed to initialize room bot:', error.message);
    })));

    botManager.classificationProducers = channels.length;
    if (botManager.config.baseConfig.excludeAdmins) {
      await ensureClassificationBots(botManager, estimatedUsers);
      if (!botManager.getClassificationBots().length) {
        throw new Error('تعذر إنشاء حسابات التصنيف');
      }
      botManager.emitClassificationStatus('classifying');
      startClassificationWorkers(botManager);
    }

    const extractionResults = await Promise.allSettled(channels.map((channelId, index) =>
      fetchOnly(botManager, producerBots[index], channelId, generation)
    ));
    const extractionFailure = extractionResults.find(result => result.status === 'rejected');
    if (extractionFailure) { throw extractionFailure.reason; }

    // Discovery accounts are no longer classification workers and can be released
    // as soon as every room page has been published.
    if (!await releasePreparationRoomBots(botManager, producerBots, generation)) { return; }

    if (botManager.config.baseConfig.excludeAdmins) {
      await waitForClassificationWorkers(botManager, generation);
    }
    if (botManager.isClassificationCancelled(generation)) { return; }

    botManager.seenUsers.clear();
    botManager.clearPendingClassificationQueue();
    setStepState(botManager, 'members');
    botManager.clearChannels();
    await sendUpdateEvent(botManager, updateEvents.users.setup, { users: botManager.getUsers().length });
    if (botManager.unknownUsers.size && botManager.config.baseConfig.autoRun) {
      await reportAutoClassification(botManager);
      botManager.startSlowUnknownRetry();
    } else if (!botManager.unknownUsers.size) {
      botManager.emitClassificationStatus('idle');
      await botManager.clearClassificationBots();
    }

    if (!botManager.isReseting) {
      await sendPrivateMessage(
        botManager.config.baseConfig.orderFrom,
        `${adBotSteps.members.description}\n${adBotSteps.members.nextStepMessage}`,
        mainBot,
        mainBot
      );
    }
  } catch (error) {
    if (generation !== null && botManager.isClassificationCancelled(generation)) { return; }
    console.error('handlePrepareCommand failed:', error);
    if (roomPoolConnectionFailed) {
      // The operator-provided first room bot remains available so preparation
      // can be retried. Only temporary per-room producers are rolled back.
      await botManager.clearRoomBots(additionalProducers);
      await botManager.clearClassificationBots();
      startRoomConnectionCooldown(botManager, { nextCommand: 'prepare' });
      const connectionError = new Error(
        `فشل اتصال أحد حسابات الرومات. تم إغلاق حسابات الرومات الإضافية والإبقاء على حساب الرومات الرئيسي.
${userMessages.preparationConnectionCooldownStarted}`
      );
      connectionError.cause = error;
      throw connectionError;
    }
    await botManager.clearRoomBots(producerBots.length ? producerBots : null);
    await botManager.clearClassificationBots();
    await sendPrivateMessage(botManager.config.baseConfig.orderFrom, 'فشل تجهيز بوت الغرفة، يرجى المحاولة مجدداً', mainBot, mainBot);
    throw error;
  } finally {
    if (generation === null || botManager._activePreparationGeneration === generation) {
      botManager.setIsBusy(false);
      botManager.isPreparing = false;
      botManager._activePreparationGeneration = null;
    }
  }
};
