import { MEMBER_LISTS } from '../constants.js';
import { PalringoClientError } from '../errors.js';
import { asPositiveInteger } from '../utils.js';

export default class MemberService {
  constructor (client) {
    this.client = client;
  }

  async * pages (channelId, type = 'regular', options = {}) {
    const id = asPositiveInteger(channelId, 'channelId');
    const definition = MEMBER_LISTS[type];
    if (!definition) {
      throw new PalringoClientError(`Unknown member list: ${type}`);
    }

    const limit = Math.max(0, Number(options.limit ?? Number.MAX_SAFE_INTEGER));
    const requestedPageSize = Number(options.pageSize ?? definition.pageSize ?? limit);
    const pageSize = Number.isFinite(requestedPageSize)
      ? Math.max(1, Math.min(Math.floor(requestedPageSize), definition.pageSize ?? requestedPageSize))
      : definition.pageSize ?? Number.MAX_SAFE_INTEGER;
    let total = 0;
    let after;
    let offset = 0;

    while (total < limit && options.signal?.aborted !== true) {
      const requested = Math.min(pageSize, limit - total);
      const body = {
        [definition.key]: id
      };
      if (definition.pageSize) { body.limit = requested; }
      if (definition.filter) { body.filter = definition.filter; }
      if (definition.subscribe !== undefined) { body.subscribe = definition.subscribe; }
      if (definition.pagination === 'after' && after !== undefined) { body.after = after; }
      if (definition.pagination === 'offset') { body.offset = offset; }

      const response = await this.client.request(definition.command, {
        headers: { version: definition.version },
        body
      }, options.request);
      const members = Array.isArray(response?.body) ? response.body : [];
      if (!members.length) { break; }

      yield members;
      total += members.length;
      if (definition.pagination === 'none') { break; }
      if (members.length < requested) { break; }

      if (definition.pagination === 'offset') {
        offset += members.length;
      } else {
        const lastId = Number(members.at(-1)?.id);
        if (!Number.isInteger(lastId) || lastId <= 0 || lastId === after) { break; }
        after = lastId;
      }
    }
  }

  async list (channelId, type = 'regular', options = {}) {
    const members = [];
    for await (const page of this.pages(channelId, type, options)) {
      if (options.onPage) { await options.onPage(page, type); }
      if (options.collect !== false) { members.push(...page); }
    }
    return members;
  }

  async getList (channelId, type = 'regular', options = {}) {
    return await this.list(channelId?.id ?? channelId, type, options);
  }
}
