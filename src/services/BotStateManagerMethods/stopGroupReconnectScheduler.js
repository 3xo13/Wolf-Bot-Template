export function stopGroupReconnectSchedulerFn (manager, type) {
  const refProp = `_${type}BotsSchedulerRef`;
  if (manager[refProp]) {
    clearTimeout(manager[refProp]);
    manager[refProp] = null;
  }
  try { manager[`${type}BotsSchedulerTriggerAt`] = null; } catch (e) { }
}
