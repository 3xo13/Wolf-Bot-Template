export const sendUpdateEvent = async (botManager, event, payload) => {
  // console.log('🚀 ~ sendUpdateEvent ~ event, payload:', event, payload);
  try {
    const socket = botManager?.socket;
    if (!socket?.connected) { return false; }
    socket.emit(event, payload);
    return true;
  } catch (error) {
    console.log('🚀 ~ sendUpdateEvent ~ error:', error);
    throw error;
  }
};
