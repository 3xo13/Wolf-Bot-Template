import waitUntilAllBotsIdle from '../../helpers/waitForBotsIdle.js';

/**
 * Extract WOLF group/channel ID from internal WOLF URLs
 * @param {String} url - URL to check
 * @returns {Number|null} Group ID or null
 */

/**
 * Find and annotate WOLF internal group links for embeds
 * @param {String} message - Message text containing links
 * @returns {Array} Array of link objects with groupId for GROUP_PREVIEW embeds
 */

/**
 * Send a private message to a subscriber using the official WOLF client
 * @param {Number} subscriberId - The target subscriber ID
 * @param {String|Buffer} message - The message content
 * @param {Object} client - The WOLF client instance (CustomWOLF)
 * @param {Object} mainBot - The main bot instance (optional, for idle waiting)
 * @param {Object} adBotClient - Alternative client to use (optional)
 * @returns {Promise<Response>} WOLF API response
 */
export async function sendPrivateMessage (subscriberId, message, client, mainBot, adBotClient) {
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

    const options = {
      formatting: {
        includeEmbeds: true, // Enable link previews and embeds
        renderAds: true,
        renderLinks: true,
        success: false,
        failed: false,
        me: false,
        alert: false
      }
    };

    // Official WOLF API handles message chunking, formatting, and socket emission internally
    const response = await activeClient.messaging.sendPrivateMessage(
      targetId,
      message.toString(),
      options
    );

    console.log('🚀 ~ sendPrivateMessage ~ response:', response);
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
