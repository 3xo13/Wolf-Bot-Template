import waitUntilAllBotsIdle from '../../helpers/waitForBotsIdle.js';

/**
 * Extract WOLF group/channel ID from internal WOLF URLs
 * @param {String} url - URL to check
 * @returns {Number|null} Group ID or null
 */
function extractWolfGroupId(url) {
  // Match patterns like:
  // https://app.wolf.live/12345 (direct ID)
  // https://app.wolf.live/g/12345 (with /g/ prefix)
  // https://wolf.live/12345
  // https://wolf.live/g/12345
  // wolf://g/12345
  const patterns = [
    /(?:https?:\/\/)?(?:app\.)?wolf\.live\/g\/(\d+)/i,  // with /g/
    /(?:https?:\/\/)?(?:app\.)?wolf\.live\/(\d+)/i,     // direct ID
    /wolf:\/\/g\/(\d+)/i                                  // wolf:// protocol
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return parseInt(match[1]);
    }
  }
  return null;
}

/**
 * Find and annotate WOLF internal group links for embeds
 * @param {String} message - Message text containing links
 * @returns {Array} Array of link objects with groupId for GROUP_PREVIEW embeds
 */
function findWolfGroupLinks(message) {
  const links = [];

  // Find all WOLF group URLs in the message
  // Matches: app.wolf.live/12345, app.wolf.live/g/12345, wolf.live/12345, wolf://g/12345
  const urlPattern = /(?:https?:\/\/)?(?:(?:app\.)?wolf\.live\/(?:g\/)?(\d+)|wolf:\/\/g\/(\d+))/gi;
  let match;

  // Reset regex state
  urlPattern.lastIndex = 0;

  while ((match = urlPattern.exec(message)) !== null) {
    const url = match[0];
    const groupId = extractWolfGroupId(url);

    if (groupId) {
      links.push({
        start: match.index,
        end: match.index + url.length,
        url: url,
        groupId: groupId  // This tells WOLF API to create GROUP_PREVIEW embed
      });
    }
  }

  return links;
}

/**
 * Send a private message to a subscriber using the official WOLF client
 * @param {Number} subscriberId - The target subscriber ID
 * @param {String|Buffer} message - The message content
 * @param {Object} client - The WOLF client instance (CustomWOLF)
 * @param {Object} mainBot - The main bot instance (optional, for idle waiting)
 * @param {Object} adBotClient - Alternative client to use (optional)
 * @returns {Promise<Response>} WOLF API response
 */
export async function sendPrivateMessage(subscriberId, message, client, mainBot, adBotClient) {
  console.log('🚀 ~ sendPrivateMessage ~ subscriberId:', subscriberId);

  if (!subscriberId || !message) {
    throw new Error('subscriberId and message are required');
  }

  const targetId = parseInt(subscriberId.toString());
  if (isNaN(targetId) || targetId <= 0) {
    throw new Error('subscriberId must be a valid positive number');
  }

  if (mainBot) {
    await waitUntilAllBotsIdle([mainBot]);
  }

  try {
    // Use the official WOLF client's messaging.sendPrivateMessage method
    const activeClient = adBotClient || client;

    // Find WOLF internal group links for GROUP_PREVIEW embeds
    const wolfGroupLinks = findWolfGroupLinks(message.toString());

    const options = {
      formatting: {
        includeEmbeds: true,  // Enable link previews and embeds
        renderAds: true,
        renderLinks: true,
        success: false,
        failed: false,
        me: false,
        alert: false
      }
    };

    // Add WOLF group links with groupId for automatic GROUP_PREVIEW embeds
    if (wolfGroupLinks.length > 0) {
      options.links = wolfGroupLinks;
    }

    // Official WOLF API handles message chunking, formatting, and socket emission internally
    const response = await activeClient.messaging.sendPrivateMessage(
      targetId,
      message.toString(),
      options
    );

    return response;
  } catch (error) {
    console.error('Full error:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      targetId,
      messageText: message.toString()
    });

    throw error;
  }
}
