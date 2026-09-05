export default class ProtocolSocket {
  constructor (client) {
    this.client = client;
  }

  get socket () {
    return this.client.transport.socket;
  }

  async emit (command, payload) {
    return await this.client.request(command, payload);
  }
}
