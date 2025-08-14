
/**
 *
 * @param {import('wolf.js').WOLF} client
 * @param {import('wolf.js').CommandContext} command
 */
export default async (client, command) => await command.reply(command.getPhrase(`${client.config.keyword}_help_message`));
