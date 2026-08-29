import { getAllChannelMembers } from './getAllChannelMembers.js';

export async function getChannelList (roomBot) {
  if (!roomBot.connected) {
    throw new Error('Not connected');
  }
  // Use official WOLF API to get channel list
  const response = await roomBot.channel.list();
  return response;
}

export const extractChannelMembers = async (roomBot, botManager, channelId, generation = null) => {
  try {
    if (!roomBot.connected) {
      throw new Error('بوت الغرفة غير متصل');
    }
    if (botManager.isReseting || (generation !== null && botManager.isClassificationCancelled(generation))) {
      throw new Error('البوت في وضع إعادة التعيين، لا يمكن استخراج المستخدمين الآن');
    }
    try {
      await getAllChannelMembers(
        botManager,
        roomBot,
        channelId,
        99999999,
        async (members) => {
          for (const member of members) {
            if (botManager.isReseting || (generation !== null && botManager.isClassificationCancelled(generation))) { return; }
            if (member?.id) { botManager.enqueueCandidate(member.id); }
          }
        },
        false,
        generation
      );
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
