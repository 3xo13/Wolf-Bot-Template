// this object should match exactly the same object in the client files
export const updateEvents = {
  room: {
    setup: 'room:setup',
    delete: 'room:delete'
  },
  channels: {
    setup: 'channels:setup',
    update: 'channels:update',
    delete: 'channels:delete'
  },
  ad: {
    setup: 'ad:setup',
    start: 'ad:start',
    delete: 'ad:delete',
    done: 'ad:done',
    update: 'ad:update'
  },
  message: {
    setup: 'message:setup',
    update: 'message:update',
    delete: 'message:delete'
  },
  messagingStyle: {
    setup: 'messagingStyle:setup',
    delete: 'messagingStyle:delete'
  },
  users: {
    setup: 'users:setup',
    delete: 'users:delete'
  },
  state: {
    clear: 'state:clear',
    reset: 'state:reset'
  },
  counter: {
    update: 'counter:update',
    reset: 'counter:reset'
  },
  bots: {
    main: {
      connected: 'bots:main:connected',
      disconnected: 'bots:main:disconnected'
    },
    room: {
      connected: 'bots:room:connected',
      disconnected: 'bots:room:disconnected'
    },
    ad: {
      connected: 'bots:ad:connected',
      disconnected: 'bots:ad:disconnected'
    }
  }
};
