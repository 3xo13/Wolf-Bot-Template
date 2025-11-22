export function updateChannelUserFn (manager, userId, timer) {
  const userTimer = manager.channelUsers.get(userId)?.timer || 0;
  if (manager.channelUsers.has(userId)) {
    if (userTimer > Date.now()) {
      return;
    } else {
      manager.channelUsers.set(userId, { timer });
      manager.channelUsersToMessageQueue.push({ userId, addedAt: Date.now() });
    }
  } else {
    manager.channelUsers.set(userId, { timer });
    manager.channelUsersToMessageQueue.push({ userId, addedAt: Date.now() });
  }
}

export default updateChannelUserFn;
