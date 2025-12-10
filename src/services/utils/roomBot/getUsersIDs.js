import { getAllChannelMembers } from './getAllChannelMembers.js';

export async function getChannelList (roomBot) {
  if (!roomBot.connected) {
    throw new Error('Not connected');
  }
  // Use official WOLF API to get channel list
  const response = await roomBot.channel.list();
  return response;
}

export const extractChannelMembers = async (roomBot, botManager, channelId) => {
  try {
    if (!roomBot.connected) {
      throw new Error('بوت الغرفة غير متصل');
    }

    try {
      const allMembers = await getAllChannelMembers(
        roomBot,
        channelId,
        99999999
      );

      // In getUsersIDs.js
      if (allMembers?.allMembers?.length) {
        console.log(`🔵 Starting to add ${allMembers.allMembers.length} members from channel ${channelId}`);
        allMembers.allMembers.forEach((member) => {
          botManager.addUser(member.id.toString());
        });
        console.log(`🟢 Finished adding members from channel ${channelId}`);
      }
    } catch (error) {
      console.log(`❌ Channel ${channelId}: Failed to extract members -`, error.message);
      throw error;
    }

    return true;
  } catch (error) {
    console.log(`❌ Error in extractChannelMembers for channel ${channelId}:`, error.message);
    throw error;
  }
};
