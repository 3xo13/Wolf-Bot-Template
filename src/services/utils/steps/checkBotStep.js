import { adBotSteps } from '../constants/adBotSteps.js';
import { magicBotSteps } from '../constants/magicBotSteps.js';

export const checkBotStep = (botManager, stepName) => {
  console.log('🚀 ~ checkBotStep ~ stepName:', stepName);
  if (!botManager || !stepName) {
    throw new Error('Missing parameters');
  }
  const botType = botManager.getBotType();
  const currentStep = botManager.getCurrentStep();

  let stepNumberFromName;
  if (botType === 'ad') {
    stepNumberFromName = adBotSteps[stepName]?.stepNumber;
  } else if (botType === 'magic') {
    stepNumberFromName = magicBotSteps[stepName]?.stepNumber;
  } else {
    throw new Error('incorrect bot type');
  }

  if (!stepNumberFromName) {
    throw new Error('step not found');
  }

  return currentStep === stepNumberFromName;
};
