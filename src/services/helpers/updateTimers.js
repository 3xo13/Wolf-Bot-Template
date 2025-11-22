const timeout = 30 * 60 * 1000; // 30 minutes
export const updateTimers = (botManager, botType) => {
  if (!botManager) {
    console.error('Bot manager is not defined');
  }
  switch (botType) {
    case 'main':
      botManager.updateMainBotCounter(timeout);
      break;

    case 'room':
      botManager.updateRoomBotsCounter(timeout);
      break;

    case 'ad':
      botManager.updateAdBotsCounter(timeout);
      break;

    default:
      console.error('!unknown bot type');
      break;
  }
};
