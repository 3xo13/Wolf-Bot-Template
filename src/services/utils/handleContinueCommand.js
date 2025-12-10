import { updateEvents } from './constants/updateEvents.js';
import { checkBotStep } from './steps/checkBotStep.js';
import handleBotStepReplay from './steps/handleBotStepReplay.js';
import { sendUpdateEvent } from './updates/sendUpdateEvent.js';

const handleContinueCommand = async (botManager) => {
  try {
    const mainBot = botManager.getMainBot();
    if (!checkBotStep(botManager, 'adsSent')) {
      await handleBotStepReplay(botManager);
    }
    await sendUpdateEvent(botManager, updateEvents.state.clear, { });
    await handleBotStepReplay(botManager);
  } catch (error) {
    console.log('🚀 ~ handleContinueCommand ~ error:', error);
    throw error;
  }
};

export default handleContinueCommand;
