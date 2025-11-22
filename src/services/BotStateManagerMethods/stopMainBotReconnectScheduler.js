export function stopMainBotReconnectSchedulerFn (manager) {
  if (manager._mainBotSchedulerRef) {
    clearTimeout(manager._mainBotSchedulerRef);
    manager._mainBotSchedulerRef = null;
  }
}
