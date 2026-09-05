import { COMMANDS } from '../constants.js';
import { PalringoClientError } from '../errors.js';
import { asPositiveInteger, chunk, responseSucceeded } from '../utils.js';
import MemberService from './MemberService.js';

function normalizeChannel (module, fallback = {}) {
  const source = module?.base || module || {};
  return {
    ...source,
    id: Number(source.id ?? fallback.id),
    name: source.name ?? fallback.name,
    membersCount: Number(source.memberCount ?? source.members ?? source.membersCount ?? 0),
    extended: module?.extended,
    audioCounts: module?.audioCounts,
    audioConfig: module?.audioConfig,
    messageConfig: module?.messageConfig
  };
}

function profileModules (response) {
  const values = Array.isArray(response?.body) ? response.body : Object.values(response?.body || {});
  return values.map(value => value?.body && responseSucceeded(value) ? value.body : value);
}

export default class ChannelService {
  constructor (client) {
    this.client = client;
    this.cache = new Map();
    this.members = new MemberService(client);
    this.member = this.members;
  }

  remember (channel) {
    if (channel?.id) { this.cache.set(Number(channel.id), channel); }
    return channel;
  }

  async getByIds (ids, { subscribe = true, refresh = false } = {}) {
    const normalizedIds = [...new Set(ids.map(id => asPositiveInteger(id, 'channelId')))];
    const result = new Map();
    if (!refresh) {
      for (const id of normalizedIds) {
        if (this.cache.has(id)) { result.set(id, this.cache.get(id)); }
      }
    }

    for (const idList of chunk(normalizedIds.filter(id => !result.has(id)), 50)) {
      const response = await this.client.request(COMMANDS.groupProfile, {
        headers: { version: 4 },
        body: {
          idList,
          subscribe,
          entities: ['base', 'extended', 'audioCounts', 'audioConfig', 'messageConfig']
        }
      });
      const modules = profileModules(response);
      idList.forEach((id, index) => {
        const matchingModule = modules.find(module => Number(module?.base?.id ?? module?.id) === id);
        const channel = this.remember(normalizeChannel(matchingModule ?? modules[index], { id }));
        result.set(id, channel);
      });
    }
    return normalizedIds.map(id => result.get(id));
  }

  async getById (id, options = {}) {
    return (await this.getByIds([id], options))[0];
  }

  async getByName (name, { subscribe = true, refresh = false } = {}) {
    const normalizedName = String(name || '').trim().toLocaleLowerCase();
    if (!normalizedName) { throw new PalringoClientError('channel name is required'); }
    if (!refresh) {
      const cached = [...this.cache.values()].find(channel => channel.name?.toLocaleLowerCase() === normalizedName);
      if (cached) { return cached; }
    }
    const response = await this.client.request(COMMANDS.groupProfile, {
      headers: { version: 4 },
      body: {
        name: normalizedName,
        subscribe,
        entities: ['base', 'extended', 'audioCounts', 'audioConfig', 'messageConfig']
      }
    });
    return this.remember(normalizeChannel(profileModules(response)[0], { name }));
  }

  async list ({ subscribe = true, refresh = false } = {}) {
    const response = await this.client.request(COMMANDS.subscriberGroupList, { subscribe });
    const memberships = Array.isArray(response?.body) ? response.body : [];
    const channels = await this.getByIds(memberships.map(channel => channel.id), { subscribe, refresh });
    return channels.map(channel => ({
      ...channel,
      inChannel: true,
      capabilities: memberships.find(item => Number(item.id) === Number(channel.id))?.capabilities
    }));
  }

  clear () {
    this.cache.clear();
  }
}
