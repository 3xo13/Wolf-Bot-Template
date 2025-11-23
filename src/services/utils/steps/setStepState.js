import { adBotSteps } from '../constants/adBotSteps.js';
import { magicBotSteps } from '../constants/magicBotSteps.js';

export const setStepState = (botManager, event) => {
  const botType = botManager.getBotType();
  if (botType === 'ad') {
    switch (event) {
      case 'members':
        botManager.setCurrentStep(adBotSteps.members.stepNumber);
        break;

      case 'message':
        botManager.setCurrentStep(adBotSteps.message.stepNumber);
        break;

      case 'ad':
        botManager.setCurrentStep(adBotSteps.ad.stepNumber);
        break;

      case 'room':
        botManager.setCurrentStep(adBotSteps.room.stepNumber);
        break;

      case 'adStyle':
        botManager.setCurrentStep(adBotSteps.adStyle.stepNumber);
        break;

      case 'adsSent':
        botManager.setCurrentStep(adBotSteps.adsSent.stepNumber);
        break;

      case 'sending':
        botManager.setCurrentStep(adBotSteps.sending.stepNumber);
        break;

      case 'main':
        botManager.setCurrentStep(adBotSteps.main.stepNumber);
        break;

      default:
        throw new Error('unknown step for ad bot');
    }
  } else if (botType === 'magic') {
    switch (event) {
      case 'room':
        botManager.setCurrentStep(magicBotSteps.room.stepNumber);
        break;

      case 'adStyle':
        botManager.setCurrentStep(magicBotSteps.adStyle.stepNumber);
        break;

      case 'adsSent':
        botManager.setCurrentStep(magicBotSteps.adsSent.stepNumber);
        break;

      case 'ad':
        botManager.setCurrentStep(magicBotSteps.ad.stepNumber);
        break;

      case 'messaging':
        botManager.setCurrentStep(magicBotSteps.messaging.stepNumber);
        break;

      case 'message':
        botManager.setCurrentStep(magicBotSteps.message.stepNumber);
        break;

      case 'main':
        botManager.setCurrentStep(magicBotSteps.main.stepNumber);
        break;

      default:
        throw new Error('unknown step for magic bot');
    }
  } else {
    throw new Error('incorrect bot type');
  }
};

export default setStepState;
