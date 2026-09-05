import { SERVER_EVENTS } from '../constants.js';
import { normalizeMessage, normalizeStageActivity } from './normalizers.js';

export default class ProtocolEventRouter {
  constructor (client) {
    this.client = client;
  }

  async route (event, packet) {
    const body = packet?.body ?? packet;
    switch (event) {
      case SERVER_EVENTS.welcome:
        await this.client.acceptWelcome(body || {});
        break;
      case SERVER_EVENTS.objection:
        this.client.acceptObjection(body || {});
        break;
      case SERVER_EVENTS.messageSend:
        this.routeMessage(packet);
        break;
      case SERVER_EVENTS.groupAudioSlotUpdate:
        this.routeAudioSlot(packet);
        break;
      case SERVER_EVENTS.groupAudioUpdate:
        this.client.emit('channelAudioUpdate', normalizeStageActivity(packet));
        break;
      case SERVER_EVENTS.groupAudioCountUpdate:
      case SERVER_EVENTS.groupAudioRequestAdd:
      case SERVER_EVENTS.groupAudioRequestClear:
      case SERVER_EVENTS.groupAudioRequestDelete:
        this.client.emit('channelAudioUpdate', normalizeStageActivity(packet));
        break;
      default:
        break;
    }
    this.client.emit('rawEvent', event, body);
  }

  routeMessage (packet) {
    const message = normalizeMessage(packet);
    this.client.emit('message', message);
    this.client.emit(message.isGroup ? 'channelMessage' : 'privateMessage', message);
  }

  routeAudioSlot (packet) {
    const activity = normalizeStageActivity(packet);
    this.client.emit('channelAudioSlotUpdate', activity);
    this.client.emit('groupAudioSlotUpdate', activity);
    this.client.emit('activity', activity);
  }
}
