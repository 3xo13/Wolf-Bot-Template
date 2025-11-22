export async function runMainBotReconnectFn (manager) {
  // if already busy, reschedule and return
  if (manager.isBusy) {
    try { manager.startMainBotReconnectScheduler(); } catch (e) { }
    return;
  }

  // normalize timer to milliseconds (if the manager stores seconds, convert)
  const defaultMs = 30 * 60 * 1000; // 30 minutes
  const initial = manager.mainBotReconnectTimer;
  let remainingMs = (typeof initial === 'number') ? (initial < 1000 ? initial * 1000 : initial) : defaultMs;

  // start per-second updater to keep manager timer in sync (write ms)
  let updater = null;
  try {
    updater = setInterval(() => {
      try {
        if (remainingMs > 0) { remainingMs = Math.max(0, remainingMs - 1000); }
        manager.updateMainBotCounter(remainingMs);
      } catch (e) { }
    }, 1000);

    // mark busy
    manager.setIsBusy(true);

    try {
      // If the main bot was cleared while waiting, stop scheduler and exit
      if (!manager.mainBot) {
        try { if (updater) { clearInterval(updater); } } catch (e) { }
        try { manager.stopMainBotReconnectScheduler(); } catch (e) { }
        return;
      }

      if (manager.mainBot) {
        try { await manager.mainBot.disconnect(); } catch (e) { }
        try { await manager.mainBot.connect(); } catch (e) {
          // If reconnect on existing instance fails, attempt to recreate
          try { await manager.connect('main'); } catch (err) { console.warn('Failed to recreate main bot:', err?.message || err); }
        }
      } else {
        try { await manager.connect('main'); } catch (e) { console.warn('Failed to create main bot during scheduled reconnect:', e?.message || e); }
      }
    } finally {
      manager.setIsBusy(false);
    }
  } finally {
    if (updater) { clearInterval(updater); }
    // ensure manager timer is updated/reset after run
    try {
      manager.updateMainBotCounter(remainingMs || defaultMs);
    } catch (e) { }
  }
}
