export function startGroupReconnectSchedulerFn (manager, type) {
  const timerProp = type === 'room' ? 'roomBotsReconnectTimer' : 'adBotsReconnectTimer';
  const refProp = `_${type}BotsSchedulerRef`;

  // clear existing
  if (manager[refProp]) {
    clearTimeout(manager[refProp]);
    manager[refProp] = null;
  }

  const timeout = manager[timerProp] || (2 * 60 * 1000); // default 30min
  const triggerIn = Math.max(timeout - 30000, 0); // start 30s before timer ends
  // record when this scheduler will trigger so callers can inspect remaining time
  manager[`${type}BotsSchedulerTriggerAt`] = Date.now() + triggerIn;
  manager[refProp] = setTimeout(() => {
    // clear recorded trigger time immediately before running
    try { manager[`${type}BotsSchedulerTriggerAt`] = null; } catch (e) { }
    // run reconnect flow for the group
    try {
      manager._runGroupReconnect(type).catch((e) => {
        console.error(`${type} bots reconnect error:`, e?.message || e);
      });
    } catch (e) {
      console.error('Failed to start group reconnect runner:', e?.message || e);
    }
  }, triggerIn);
}
