function sleep (ms) { return new Promise(r => setTimeout(r, ms)); }

export async function runGroupReconnectFn (manager, type) {
  // if manager busy, reschedule
  if (manager.isBusy) {
    try { manager.startGroupReconnectScheduler(type); } catch (e) { }
    return;
  }

  const bots = type === 'room' ? manager.roomBots : manager.adBots;
  if (!Array.isArray(bots) || bots.length === 0) { return; }

  // Wait until all bots are not working. While waiting, mark any bot that is currently not working as busy
  // to preserve it from being assigned new work. Poll every 5 seconds.
  // Also update the manager's group timer every second (in milliseconds).
  const defaultMs = 30 * 60 * 1000; // 30 minutes
  const initial = (type === 'room') ? manager.roomBotsReconnectTimer : manager.adBotsReconnectTimer;
  let remainingMs = (typeof initial === 'number') ? (initial < 1000 ? initial * 1000 : initial) : defaultMs;
  let updater = null;
  try {
    updater = setInterval(() => {
      try {
        if (remainingMs > 0) { remainingMs = Math.max(0, remainingMs - 1000); }
        if (type === 'room') { manager.updateRoomBotsCounter(remainingMs); } else { manager.updateAdBotsCounter(remainingMs); }
      } catch (e) { }
    }, 1000);
    let allIdle = false;
    while (!allIdle) {
      allIdle = true;
      // if the bot list was cleared while waiting, cleanup and exit
      const currentBots = type === 'room' ? manager.roomBots : manager.adBots;
      if (!Array.isArray(currentBots) || currentBots.length === 0) {
        try { if (updater) { clearInterval(updater); } } catch (e) { }
        try { if (type === 'room') { manager.stopRoomBotsReconnectScheduler(); } else { manager.stopAdBotsReconnectScheduler(); } } catch (e) { }
        return;
      }

      for (const bot of bots) {
        // if bot is currently working, we are not ready
        if (bot.isWorking) {
          allIdle = false;
        } else {
          // bot is idle; ensure it's marked busy to preserve it
          try { if (typeof bot.setIsBusy === 'function') { bot.setIsBusy(true); } } catch (e) { }
        }
      }

      if (allIdle) { break; }

      // wait 5 seconds and re-check
      await sleep(5000);
    }

    // At this point all bots are idle and marked busy. Attempt to reconnect all of them concurrently.
    const roomConfig = type === 'room' ? manager.config.roomBotConfig : null;
    const adConfig = type === 'ad' ? manager.config.adBotConfig : null;
    const reconnectPromises = bots.map(async (bot, index) => {
      try {
        if (typeof bot.logout === 'function') {
          try { await bot.logout(); } catch (e) { }
        }
        if (typeof bot.login === 'function') {
          try {
            // For room bots, use token from manager's token array; for ad bots, use shared config
            const loginConfig = type === 'room'
              ? { ...roomConfig, token: manager.roomBotsTokens[index] }
              : adConfig;
            await bot.login(loginConfig);
          } catch (e) {
            // if per-instance reconnect fails, log and continue
            console.warn(`${type} bot reconnect failed:`, e?.message || e);
          }
        }
      } finally {
        // leave busy flag until we've finished restarting all bots below
      }
    });

    await Promise.allSettled(reconnectPromises);
  } finally {
    if (updater) { clearInterval(updater); }
    // Unmark busy for all bots and update manager timer
    try {
      for (const bot of (type === 'room' ? manager.roomBots : manager.adBots)) {
        try { if (typeof bot.setIsBusy === 'function') { bot.setIsBusy(false); } } catch (e) { }
      }
    } catch (e) { }

    // update group's timer and restart scheduler
    try {
      // ensure manager timer is updated/reset after run (use remainingMs if available)
      if (type === 'room') { manager.updateRoomBotsCounter(remainingMs || defaultMs); } else { manager.updateAdBotsCounter(remainingMs || defaultMs); }
    } catch (e) { }
  }
}
