export const sendUpdateEvent = async (botManager, event, payload) => {
  console.log('🚀 ~ sendUpdateEvent ~ event, payload:', event, payload);
  try {
    const socket = botManager.socket;
    socket.emit(event, payload);
  } catch (error) {
    console.log('🚀 ~ sendUpdateEvent ~ error:', error);
    throw error;
  }
};
