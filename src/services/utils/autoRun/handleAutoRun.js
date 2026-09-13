import { sendPrivateMessage } from '../messaging/sendPrivateMessage.js';
import { handleAdBotAutoRun } from './handleAdBotAutoRun.js';
import { handleMagicBotAutoRun } from './handleMagicBotAutoRun.js';

export async function preflightAppCheck (botManager, targets) {
  let nextIndex = 0;
  let firstFailure = null;
  const resume = () => botManager.startAutoRunTask(handleAutoRun);
  const workers = Array.from({ length: Math.min(2, targets.length) }, async () => {
    while (!firstFailure && nextIndex < targets.length) {
      const target = targets[nextIndex++];
      try {
        await botManager.ensureAppCheck(target.type, target.index, {
          accessToken: target.accessToken,
          continuationKey: 'auto-run',
          continuation: resume
        });
      } catch (error) {
        firstFailure ||= error;
      }
    }
  });
  await Promise.allSettled(workers);
  if (firstFailure) { throw firstFailure; }
}

export const handleAutoRun = async (botManager) => {
  const botType = botManager.getBotType();
  const mainBot = botManager.getMainBot();
  try {
    const roomTokens = Array.isArray(botManager.config.roomBotConfig.token)
      ? botManager.config.roomBotConfig.token
      : [botManager.config.roomBotConfig.token].filter(Boolean);
    const roomTargets = botType === 'ad' ? roomTokens.slice(0, 1) : roomTokens;
    const targets = roomTargets.map((accessToken, index) => ({ type: 'room', index, accessToken }));
    targets.push(...botManager.config.adBotConfig.map((config, index) => ({
      type: 'ad', index, accessToken: config.token
    })));
    if (botManager.config.baseConfig.excludeAdmins) {
      targets.push({ type: 'classification', index: 0, accessToken: '' });
    }
    await preflightAppCheck(botManager, targets);
    switch (botType) {
      case 'ad':
        await handleAdBotAutoRun(botManager);
        break;
      case 'magic':
        await handleMagicBotAutoRun(botManager);
        break;
      default:
        console.warn(`⚠️ Unknown bot type: ${botType}`);
        throw new Error(`Unknown bot type: ${botType}`);
    }
  } catch (error) {
    console.log('🚀 ~ handleAutoRun ~ error:', error?.message || 'unknown error');
    if (mainBot?.connected) {
      await sendPrivateMessage(botManager.config.baseConfig.orderFrom, error.message, mainBot);
    }
  }
};
