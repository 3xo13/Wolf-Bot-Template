export const DEFAULT_CONNECTION = Object.freeze({
  host: 'https://v3.palringo.com',
  port: 443,
  device: 'mobile',
  onlineState: 1,
  version: '2.7.6',
  connectTimeout: 20000,
  authenticationTimeout: 30000,
  requestTimeout: 30000,
  maxRequestAttempts: 3,
  retryDelay: 250,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 15000
});

export const COMMANDS = Object.freeze({
  groupAudioSlotList: 'group audio slot list',
  groupMemberBannedList: 'group member banned list',
  groupMemberPrivilegedList: 'group member privileged list',
  groupMemberRegularList: 'group member regular list',
  groupMemberSearch: 'group member search',
  groupProfile: 'group profile',
  messageGroupSubscribe: 'message group subscribe',
  messageGroupUnsubscribe: 'message group unsubscribe',
  messagePrivateSubscribe: 'message private subscribe',
  messagePrivateUnsubscribe: 'message private unsubscribe',
  messageSend: 'message send',
  subscriberGroupList: 'subscriber group list'
});

export const SERVER_EVENTS = Object.freeze({
  groupAudioCountUpdate: 'group audio count update',
  groupAudioRequestAdd: 'group audio request add',
  groupAudioRequestClear: 'group audio request clear',
  groupAudioRequestDelete: 'group audio request delete',
  groupAudioSlotUpdate: 'group audio slot update',
  groupAudioUpdate: 'group audio update',
  messageSend: 'message send',
  objection: 'objection',
  welcome: 'welcome'
});

export const RETRYABLE_RESPONSE_CODES = Object.freeze([408, 500, 502, 503, 504]);

export const MEMBER_LISTS = Object.freeze({
  privileged: Object.freeze({
    command: COMMANDS.groupMemberPrivilegedList,
    key: 'id',
    pagination: 'none',
    subscribe: true,
    version: 3
  }),
  regular: Object.freeze({
    command: COMMANDS.groupMemberRegularList,
    key: 'id',
    pageSize: 100,
    pagination: 'after',
    version: 1
  }),
  silenced: Object.freeze({
    command: COMMANDS.groupMemberSearch,
    filter: 'silenced',
    key: 'groupId',
    pageSize: 50,
    pagination: 'offset',
    version: 1
  }),
  banned: Object.freeze({
    command: COMMANDS.groupMemberBannedList,
    key: 'id',
    pageSize: 50,
    pagination: 'after',
    version: 1
  }),
  bots: Object.freeze({
    command: COMMANDS.groupMemberSearch,
    filter: 'bots',
    key: 'groupId',
    pageSize: 50,
    pagination: 'offset',
    version: 1
  })
});
