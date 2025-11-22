import { getChannelMembers } from './getChannelMembers.js';
// to
export async function getAllChannelMembers(
  roomBot,
  channelId,
  limit = 100
) {
  if (!roomBot.connected) {
    throw new Error('Not connected');
  }

  const memberTypes = [
    'privileged',
    'regular',
    'silenced',
    'banned',
    'bots'
  ];
  const membersByType = {
    privileged: [],
    regular: [],
    silenced: [],
    banned: [],
    bots: []
  };
  const uniqueMembers = new Map();

  try {
    for (const type of memberTypes) {
      try {
        const response = await getChannelMembers(roomBot, channelId, type, limit);
        const memberIds = Array.isArray(response.body) ? response.body : [];
        membersByType[type] = memberIds;

        // Add IDs to unique set
        if (memberIds.length > 0) {
          memberIds.forEach((id) => {
            uniqueMembers.set(id, { id, memberType: type });
          });
        }
      } catch (error) {
        console.log(`Warning: Could not fetch ${type} members:`, error.message);
        membersByType[type] = [];
      }
    }

    const uniqueMembersList = Array.from(uniqueMembers.values());
    const totalCount = uniqueMembersList.length;

    console.log(`🎯 Channel ${channelId}: ${totalCount} unique members`);

    return {
      channelId: parseInt(channelId.toString()),
      totalMembers: totalCount,
      membersByType,
      allMembers: uniqueMembersList,
      summary: {
        privileged: membersByType.privileged?.length || 0,
        regular: membersByType.regular?.length || 0,
        silenced: membersByType.silenced?.length || 0,
        banned: membersByType.banned?.length || 0,
        bots: membersByType.bots?.length || 0
      }
    };
  } catch (error) {
    throw new Error(
      `Failed to get all channel members: ${(error).message}`
    );
  }
}
