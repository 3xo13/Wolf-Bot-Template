export async function getChannelMembers(roomBot, channelId, listType = 'regular', limit = 100) {
  if (!roomBot.connected) {
    throw new Error('Not connected');
  }

  const validListTypes = ['privileged', 'regular', 'silenced', 'banned', 'bots'];

  if (!validListTypes.includes(listType)) {
    throw new Error(
      `Invalid list type: ${listType}. Valid types: ${validListTypes.join(', ')}`
    );
  }

  try {
    // Use official WOLF API to get channel members (populates the channel's internal Map)
    await roomBot.channel.member.getList(parseInt(channelId), listType);

    // Get the channel to access its members Map directly
    const channel = await roomBot.channel.getById(parseInt(channelId));

    // Extract IDs directly from the channel's members Map
    const memberIds = [];
    if (channel.members?._members) {
      for (const [id, member] of channel.members._members) {
        if (member.lists.has(listType)) {
          memberIds.push(id);
        }
      }
    }

    // Return array of IDs
    return {
      success: true,
      code: 200,
      body: memberIds,
      totalMembers: memberIds.length
    };
  } catch (error) {
    // Return empty array for any error (404, undefined response.body, etc.)
    // This is expected for member types that don't exist (e.g., no banned members)
    console.log(`No ${listType} members found for channel ${channelId} (${error.message})`);
    return {
      success: true,
      code: 200,
      body: [],
      totalMembers: 0
    };
  }
}
