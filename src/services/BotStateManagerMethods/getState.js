export function getStateFn (manager) {
  const botType = manager.getBotType();
  return {
    mainBot: manager.mainBot?.connected,
    botType,
    roomBots: manager.roomBots.filter(bot => bot.connected).length,
    adBots: manager.adBots.filter(bot => bot.connected).length,
    channels: Array.from(manager.channels.keys()).length,
    users: Array.from(manager.users).length,
    messages: Array.from(manager.messages),
    currentStep: manager.currentStep,
    adsSent: botType === 'magic' ? manager.channelsAdsSent : manager.lastUserIndex
  };
}

export default getStateFn;
