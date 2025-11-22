import { adBotSteps } from '../constants/adBotSteps.js';
import { magicBotSteps } from '../constants/magicBotSteps.js';

export const getStep = (stepNumber, botManager) => {
  const botType = botManager.getBotType();
  if (botType === 'magic') {
    return Object.values(magicBotSteps).find(step => step.stepNumber === stepNumber);
  }
  if (botType === 'ad') {
    return Object.values(adBotSteps).find(step => step.stepNumber === stepNumber);
  }
  return null;
};
