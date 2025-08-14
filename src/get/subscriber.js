import { IconSize } from 'wolf.js/src/constants/index.js';

/**
 *
 * @param {import('wolf.js').WOLF} client
 * @param {import('wolf.js').CommandContext} command
 */
export default async (client, command) => {
    const [userInput] = command.argument.split(client.SPLIT_REGEX).map((userInput)=>Number(client.utility.number.toEnglishNumbers(userInput)))

    const subscriber = await client.subscriber.getById(userInput && !isNaN(userInput) ? userInput : command.sourceSubscriberId);

    if (!subscriber.exists) {
        return await command.reply(
            client.utility.string.replace(
                command.getPhrase(`${client.config.keyword}_subscriber_profile_error_doesnt_exist_message`),
                {
                    nickname: (await command.subscriber()).nickname,
                    subscriberId: command.sourceSubscriberId,
                    id: subscriber.id
                }
            )
        );
    }

    await command.reply(
        await client.utility.subscriber.avatar(subscriber.id, IconSize.SMALL)
            .then(async (buffer) => buffer)
            .catch(async () => command.getPhrase(`${client.config.keyword}_subscriber_no_avatar_message`))
    );

    return await command.reply(
        client.utility.string.replace(
            command.getPhrase(`${client.config.keyword}_subscriber_profile_message`),
            {
                id: subscriber.id,
                nickname: subscriber.nickname,
                charm: subscriber.charms.selectedList?.length > 0
                    ? client.utility.string.replace(
                        command.getPhrase(`${client.config.keyword}_charm_selected_message`),
                        {
                            name: (await subscriber.charms.selectedList[0].charm()).name,
                            id: subscriber.charms.selectedList[0].charmId
                        }
                    )
                    : command.getPhrase(`${client.config.keyword}_none`),
                status: subscriber.status,
                level: subscriber.reputation.toString().split('.')[0],
                percentage: `${subscriber.percentage}%`,
                onlineState: command.getPhrase(`${client.config.keyword}_onlineState_${subscriber.onlineState}`),
                deviceType: command.getPhrase(`${client.config.keyword}_deviceType_${subscriber.deviceType}`),
                gender: command.getPhrase(`${client.config.keyword}_gender_${subscriber.extended.gender}`),
                relationship: command.getPhrase(`${client.config.keyword}_relationship_${subscriber.extended.gender}`),
                lookingFor: command.getPhrase(`${client.config.keyword}_lookingFor_${subscriber.extended.gender}`),
                language: client.utility.toLanguageKey(subscriber.extended.language)
            }
        )
    );
}
