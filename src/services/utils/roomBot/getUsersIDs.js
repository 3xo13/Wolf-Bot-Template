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

    console.log(`🔄 Starting extraction for channel ${channelId}...`);

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
        console.log(`✅ Channel ${channelId}: Extracted ${allMembers.allMembers.length} members`);
        console.log(`   - Privileged: ${allMembers.summary.privileged}`);
        console.log(`   - Regular: ${allMembers.summary.regular}`);
        console.log(`   - Silenced: ${allMembers.summary.silenced}`);
        console.log(`   - Banned: ${allMembers.summary.banned}`);
        console.log(`   - Bots: ${allMembers.summary.bots}`);
      } else {
        console.log(`⚠️ Channel ${channelId}: No members found or empty result`);
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
