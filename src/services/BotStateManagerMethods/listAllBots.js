export function listAllBotsFn (manager) {
  console.log(`🚀 ~ BotStateManager ~ listAllBots ~ {
      mainBot: this.mainBot.connected,
      roomBots: this.roomBots.map(bot => bot.connected),
      adBots: this.adBots.map(bot => bot.connected)
    }:`,
  {
    mainBot: manager.mainBot?.connected,
    roomBots: manager.roomBots.map(bot => ({ connected: bot.connected, config: bot.config })),
    adBots: manager.adBots.map(bot => ({ connected: bot.connected, config: bot.config })),
    classificationBots: manager.classificationBots.map(bot => ({ connected: bot.connected }))
  }
  );
  return {
    mainBot: manager.mainBot?.connected,
    roomBots: manager.roomBots.map(bot => bot.connected),
    adBots: manager.adBots.map(bot => bot.connected),
    classificationBots: manager.classificationBots.map(bot => bot.connected)
  };
}

export default listAllBotsFn;
