# Palringo client

This folder contains the application-focused WOLF protocol client used by the server. It is not a separate package; its transport, proxy, and ID generation dependencies come from the server's existing `package.json`.

The public facade is `PalringoClient`. Its responsibilities are split across transport, request dispatching, messaging, channel/member access, stage subscriptions, and event normalization.

```js
import { PalringoClient } from './services/palringo/index.js';

const client = new PalringoClient({
  token: 'WE-...',
  host: 'wss://v3.palringo.com',
  port: 443,
  device: 'mobile',
  proxy: {
    enabled: false,
    protocol: 'http',
    host: '',
    port: 0
  }
});

client.on('disconnected', reason => console.log(reason));
client.on('resume', subscriber => console.log(subscriber.id));
client.on('channelMessage', message => console.log(message.sourceSubscriberId));
client.on('channelAudioSlotUpdate', activity => console.log(activity.occupierId));

await client.connect();
await client.messaging.subscribeToPrivateMessages();
await client.messaging.subscribeToChannels();
await client.messaging.sendPrivateMessage(123456, 'Hello');
const channels = await client.channels.list();
await client.channels.members.list(channels[0].id, 'regular', {
  collect: false,
  onPage: members => console.log(members.length)
});
await client.stage.listSlots(channels[0].id);
```

Requests are never queued while disconnected. Every request has an acknowledgement timeout and a bounded retry count. Runtime disconnect, objection, and reconnect events remain observable for the entire client lifetime.

The façade also exposes the narrow compatibility surface used by this application: `login(config)`, `channel.list()`, `websocket.emit()`, `messaging._subscribeToChannel()`, and `stage.slot.list()`. `CustomWOLF` now extends this client and contains only the manager-specific adapter behavior.
