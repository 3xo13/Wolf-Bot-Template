import { adBotSteps } from '../constants/adBotSteps.js';
import { updateEvents } from '../constants/updateEvents.js';
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';
import setStepState from '../steps/setStepState.js';
import { sendUpdateEvent } from '../updates/sendUpdateEvent.js';
import { extractChannelMembers } from './getUsersIDs.js';
import { checkBotStep } from '../steps/checkBotStep.js';
import handleBotStepReplay from '../steps/handleBotStepReplay.js';
import { classifySubscriberPatch } from '../classification/classifySubscribers.js';
import { reportAutoClassification, reportUnknownDecision, startSlowUnknownRetry } from '../classification/unknownUsers.js';

async function classificationWorker (botManager, roomBot, generation) {
  while (!botManager.isClassificationCancelled(generation)) {
    const patch = botManager.takeClassificationPatch(50, botManager.classificationProducers <= 0);
    if (patch.length) {
      botManager.classificationInFlight++;
      try {
        await classifySubscriberPatch(botManager, roomBot, patch);
      } finally {
        botManager.classificationInFlight--;
      }
      continue;
    }
    if (botManager.classificationProducers <= 0) { return; }
    await botManager.waitForRecipientChange(100);
  }
}

async function fetchAndClassify (botManager, roomBot, channelId, generation) {
  try {
    await extractChannelMembers(roomBot, botManager, channelId);
  } finally {
    botManager.classificationProducers--;
    botManager.signalRecipientChange();
  }
  if (botManager.config.baseConfig.excludeAdmins) {
    await classificationWorker(botManager, roomBot, generation);
  }
}

async function fetchOnly (botManager, roomBot, channelId) {
  try {
    await extractChannelMembers(roomBot, botManager, channelId);
  } finally {
    botManager.classificationProducers--;
    botManager.signalRecipientChange();
  }
}

export function getLowRoomClassificationWorkerCount (roomCount, userCount) {
  if (roomCount >= 3 || userCount <= 5000) { return 0; }
  return userCount < 50000 ? 3 : 5;
}

async function runLowRoomPipeline (botManager, producerBots, channels, estimatedUsers, generation) {
  const classificationBots = [];
  const workerTasks = [];

  const scaleWorkers = async (userCount) => {
    const target = getLowRoomClassificationWorkerCount(channels.length, userCount);
    const missing = target - classificationBots.length;
    if (missing <= 0) { return; }
    const connected = await Promise.all(Array.from({ length: missing }, () => botManager.connect('room')));
    classificationBots.push(...connected);
    connected.forEach(bot => workerTasks.push(classificationWorker(botManager, bot, generation)));
  };

  // Channel metadata lets large one/two-room campaigns start classifiers before extraction.
  await scaleWorkers(estimatedUsers);
  const extractionTask = Promise.allSettled(channels.map((channelId, index) =>
    fetchOnly(botManager, producerBots[index], channelId)
  ));

  while (botManager.classificationProducers > 0 && !botManager.isClassificationCancelled(generation)) {
    await scaleWorkers(botManager.seenUsers.size);
    await botManager.waitForRecipientChange(100);
  }
  await scaleWorkers(botManager.seenUsers.size);

  const extractionResults = await extractionTask;
  const extractionFailure = extractionResults.find(result => result.status === 'rejected');
  if (extractionFailure) { throw extractionFailure.reason; }

  if (!classificationBots.length) {
    producerBots.forEach(bot => workerTasks.push(classificationWorker(botManager, bot, generation)));
  }
  const workerResults = await Promise.allSettled(workerTasks);
  const workerFailure = workerResults.find(result => result.status === 'rejected');
  if (workerFailure) { throw workerFailure.reason; }
}

export const handlePrepareCommand = async (botManager) => {
  botManager.setIsBusy(true);
  const mainBot = botManager.getMainBot();
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
    botManager.emitClassificationStatus('classifying');
    await sendPrivateMessage(botManager.config.baseConfig.orderFrom, 'جاري التجهيز...', mainBot, mainBot);

    const channels = botManager.getChannels();
    const channelProfiles = await initialRoomBot.channel.list();
    const channelIds = new Set(channels.map(String));
    const estimatedUsers = channelProfiles
      .filter(channel => channelIds.has(String(channel.id)))
      .reduce((total, channel) => total + (Number(channel.membersCount) || 0), 0);
    const additionalProducers = await Promise.all(
      Array.from({ length: Math.max(0, channels.length - 1) }, () => botManager.connect('room'))
    );
    const producerBots = [initialRoomBot, ...additionalProducers];
    if (producerBots.length !== channels.length) { throw new Error('تعذر تخصيص بوت واحد لكل غرفة'); }

    await Promise.all(additionalProducers.map(bot => bot.channel.list().catch(error => {
      console.warn('Failed to initialize room bot:', error.message);
    })));

    const generation = botManager._classificationGeneration;
    botManager.classificationProducers = channels.length;
    if (botManager.config.baseConfig.excludeAdmins && channels.length < 3) {
      await runLowRoomPipeline(botManager, producerBots, channels, estimatedUsers, generation);
    } else {
      const results = await Promise.allSettled(channels.map((channelId, index) =>
        fetchAndClassify(botManager, producerBots[index], channelId, generation)
      ));
      const failed = results.find(result => result.status === 'rejected');
      if (failed) { throw failed.reason; }
    }

    // Extraction is complete; classified sets now provide all deduplication we need.
    botManager.seenUsers.clear();
    botManager.classificationQueue = [];
    botManager.classificationQueueIndex = 0;

    setStepState(botManager, 'members');
    botManager.clearChannels();
    await sendUpdateEvent(botManager, updateEvents.users.setup, { users: botManager.getUsers().length });

    if (botManager.unknownUsers.size) {
      while (botManager.getRoomBots().length > 1) {
        const bot = botManager.getRoomBots().at(-1);
        botManager.roomBots = botManager.getRoomBots().slice(0, -1);
        await bot.disconnect();
      }
      if (botManager.config.baseConfig.autoRun) {
        await reportAutoClassification(botManager);
        startSlowUnknownRetry(botManager);
      } else {
        await reportUnknownDecision(botManager);
      }
    } else {
      botManager.emitClassificationStatus('idle');
      await botManager.clearRoomBots();
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
    console.error('handlePrepareCommand failed:', error);
    await botManager.clearRoomBots();
    await sendPrivateMessage(botManager.config.baseConfig.orderFrom, 'فشل تجهيز بوت الغرفة، يرجى المحاولة مجدداً', mainBot, mainBot);
    throw error;
  } finally {
    botManager.setIsBusy(false);
    botManager.isPreparing = false;
  }
};
