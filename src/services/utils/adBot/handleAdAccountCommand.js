// This file handles the setup of ad bot accounts for sending advertisements.
// It validates input, connects ad bots, updates workflow state, and notifies the user.

import setStepState from '../steps/setStepState.js'; // Used to update the workflow step
import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js'; // Used to send notifications to the user
import { adBotSteps } from '../constants/adBotSteps.js';
import { updateEvents } from '../constants/updateEvents.js';
import { sendUpdateEvent } from '../updates/sendUpdateEvent.js';
import { checkBotStep } from '../steps/checkBotStep.js';
import { updateTimers } from '../../helpers/updateTimers.js';
import handleBotStepReplay from '../steps/handleBotStepReplay.js';
import { userMessages } from '../constants/userMessages.js';
import { assertAdConnectionCooldownComplete } from '../roomBot/roomConnectionCooldown.js';
import { connectAdAccountBatch } from './adAccountConnection.js';
import { assertConnectionBatchAvailable } from '../connections/connectBotBatch.js';

export const handleAdAccountCommand = async (botManager, data) => {
  botManager.setIsBusy(true);
  try {
    // Get the main bot instance
    const mainBot = botManager.getMainBot();
    const botType = botManager.getBotType();
    const step = botManager.getBotType() === 'ad' ? 'members' : 'room';
    assertConnectionBatchAvailable(botManager, 'ad');
    const currentAdBotIndex = botManager.config.adBotConfig.findIndex(adBot => !adBot.token);
    const existingCount = botManager.getMessageCount();
    const shuldSkipSteps = existingCount === 1 || existingCount === 3;
    assertAdConnectionCooldownComplete(botManager);
    if (!checkBotStep(botManager, step)) {
      await handleBotStepReplay(botManager);
      return;
    }
    // Check if there are users to send ads to
    if (botType === 'ad' && !botManager.getUsers().length) {
      throw new Error('لا يوجد مستخدمين في القائمة');
    }
    // Validate the provided token format
    if (!data.startsWith('WE-')) {
      throw new Error('يرجى ادخال توكين الحساب بشكل صحيح\nWE-AAAAAAAA');
    }
    // Set the ad bot token for authentication
    botManager.setAdBotToken(data, currentAdBotIndex);
    updateTimers(botManager, 'ad');
    // botManager.startAdBotsReconnectScheduler();
    // Commit this account only if every requested connection succeeds. A
    // partial failure rolls every advertising account back to account one.
    if (!await connectAdAccountBatch(botManager, currentAdBotIndex)) { return; }

    // Notify the user that ad bots are ready and provide next step instructions
    await sendUpdateEvent(botManager, updateEvents.ad.setup, { token: data, index: currentAdBotIndex });

    if (!botManager.config.adBotConfig.every(adBotConfig => adBotConfig.token)) {
      sendPrivateMessage(
        botManager.config.baseConfig.orderFrom,
        `حساب الاعلان رقم ( ${currentAdBotIndex + 1} ) متصل بنجاح
        يرجى إرسال "حساب اعلان" مع توكين الحساب رقم ( ${currentAdBotIndex + 2} )`,
        mainBot, mainBot
      ).catch(() => {});
      return;
    }

    // Update the workflow state to indicate ad step
    setStepState(botManager, 'ad');

    await sendPrivateMessage(
      botManager.config.baseConfig.orderFrom,
      `حساب الإعلان رقم( ${currentAdBotIndex + 1} ) متصل بنجاح\n${!shuldSkipSteps ? adBotSteps.ad.nextStepMessage : ''}`,
      mainBot, mainBot
    );

    if (shuldSkipSteps) {
      setStepState(botManager, 'message');
      await sendPrivateMessage(botManager.config.baseConfig.orderFrom, userMessages.skipMessageStep, botManager.getMainBot());
      await handleBotStepReplay(botManager);
      return;
    }
  } catch (error) {
    // Log and re-throw any errors encountered during ad bot setup
    console.log('🚀 ~ handleAdAccountCommand ~ error:', error);
    throw error;
  } finally {
    botManager.setIsBusy(false);
  }
};
