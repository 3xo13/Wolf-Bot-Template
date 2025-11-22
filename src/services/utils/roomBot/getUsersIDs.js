import { getAllChannelMembers } from './getAllChannelMembers.js';

export async function getChannelList(roomBot) {
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
        999999999999999
      );

      // Add all unique member IDs to botManager
      if (allMembers?.allMembers?.length) {
        allMembers.allMembers.forEach((member) => {
          botManager.addUser(member.id.toString());
        });
        console.log(`✅ Added ${allMembers.allMembers.length} users from channel ${channelId}`);
      }
    } catch (error) {
      console.log('🚀 ~ extractChannelMembers ~ error:', error);
      console.log(
        `Failed to get members from channel ${channelId}:`,
        error
      );
    }

    return true;
  } catch (error) {
    console.log('Error in extractAllMembers:', error);
    throw error;
  }
};
