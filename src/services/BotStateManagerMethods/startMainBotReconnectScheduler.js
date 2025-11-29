export function startMainBotReconnectSchedulerFn (manager) {
  // clear existing
  if (manager._mainBotSchedulerRef) {
    clearTimeout(manager._mainBotSchedulerRef);
    manager._mainBotSchedulerRef = null;
  }
  const timeout = manager.mainBotReconnectTimer || (2 * 60 * 1000); // default 30min
  const triggerIn = Math.max(timeout - 30000, 0); // start 30s before timer ends
  manager._mainBotSchedulerRef = setTimeout(() => {
    // run reconnect flow
    manager._runMainBotReconnect().catch((e) => {
      console.error('Main bot reconnect error:', e?.message || e);
    });
  }, triggerIn);
}
