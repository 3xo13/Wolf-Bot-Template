export async function getChannelMembers (roomBot, channelId, listType = 'regular', limit = 100) {
  if (!roomBot.connected) {
    throw new Error('Not connected');
  }

  const listConfig = {
    privileged: {
      command: 'group member privileged list',
      key: 'id',
      version: 3
    },
    regular: {
      command: 'group member regular list',
      key: 'id',
      version: 1
    },
    silenced: {
      command: 'group member search',
      key: 'groupId',
      version: 1
    },
    banned: {
      command: 'group member banned list',
      key: 'id',
      version: 1
    },
    bots: {
      command: 'group member search',
      key: 'groupId',
      version: 1
    }
  };

  const config = listConfig[listType];
  if (!config) {
    throw new Error(
      `Invalid list type: ${listType}. Valid types: ${Object.keys(listConfig).join(', ')}`
    );
  }

  // For regular member list, implement pagination to fetch all members
  if (listType === 'regular') {
    const allMembers = [];
    let after = null;
    const pageSize = 100; // Maximum allowed by the API
    let totalFetched = 0;
    const maxIterations = Math.ceil(limit / pageSize) + 1; // Safety limit to prevent infinite loops
    let iterations = 0;

    while (totalFetched < limit && iterations < maxIterations) {
      iterations++;
      const remainingLimit = Math.min(pageSize, limit - totalFetched);

      const body = {
        [config.key]: parseInt(channelId.toString()),
        limit: remainingLimit
      };

      // Add 'after' parameter for pagination if we have it
      if (after !== null) {
        body.after = after;
      }

      try {
        const response = await roomBot.websocket.emit(config.command, {
          headers: {
            version: config.version
          },
          body
        });

        // Extract members from response
        const members = Array.isArray(response.body)
          ? response.body
          : [];

        if (members.length === 0) {
          // No more members to fetch
          break;
        }

        allMembers.push(...members);
        totalFetched += members.length;

        // Set 'after' to the last member's ID for next iteration
        const lastMember = members[members.length - 1];
        if (lastMember && typeof lastMember.id === 'number' && lastMember.id > 0) {
          after = lastMember.id;
        } else {
          // No valid ID found, break to avoid infinite loop
          console.warn('No valid member ID found for pagination, stopping fetch');
          break;
        }

        // If we got fewer members than requested, we've reached the end
        if (members.length < remainingLimit) {
          break;
        }
      } catch (error) {
        console.error(`Error fetching regular members page ${iterations}:`, error);
        throw error;
      }
    }

    // Return response with all accumulated members
    return {
      success: true,
      code: 200,
      body: allMembers,
      totalMembers: allMembers.length,
      paginationInfo: {
        totalFetched,
        iterations,
        lastAfter: after
      }
    };
  }

  // For other list types, use the original implementation
  const body = {
    [config.key]: parseInt(channelId.toString()),
    limit
  };

  // Add filter for search-based commands
  if (listType === 'silenced' || listType === 'bots') {
    body.filter = listType;
    body.offset = 0;
  }

  return roomBot.websocket.emit(config.command, {
    headers: {
      version: config.version
    },
    body
  });
}
