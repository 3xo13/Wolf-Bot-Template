import { decodeText, packetBody } from '../utils.js';

export function normalizeMessage (packet) {
  const data = packetBody(packet) || {};
  const sourceSubscriberId = Number(
    data.originator?.id ?? data.originator ?? data.subscriberId ?? data.sourceSubscriberId
  ) || undefined;
  const isGroup = data.isGroup === true;
  const targetChannelId = isGroup
    ? Number(data.targetGroupId ?? data.recipient?.id ?? data.groupId) || undefined
    : undefined;

  return {
    id: data.id,
    body: decodeText(data.data ?? data.body),
    sourceSubscriberId,
    subscriberId: sourceSubscriberId,
    targetChannelId,
    targetGroupId: targetChannelId,
    isGroup,
    isChannel: isGroup,
    timestamp: data.timestamp,
    type: data.mimeType,
    originator: data.originator,
    recipient: data.recipient,
    raw: data
  };
}

export function normalizeStageActivity (packet) {
  const data = packetBody(packet) || {};
  const slot = data.slot || data;
  return {
    id: data.id ?? data.groupId ?? data.channelId,
    channelId: data.id ?? data.groupId ?? data.channelId,
    groupId: data.id ?? data.groupId ?? data.channelId,
    slotId: slot.id ?? data.slotId,
    subscriberId: data.subscriberId ?? data.sourceSubscriberId ?? slot.subscriberId,
    sourceSubscriberId: data.sourceSubscriberId,
    occupierId: slot.occupierId ?? data.occupierId,
    reservedOccupierId: slot.reservedOccupierId ?? data.reservedOccupierId,
    raw: data
  };
}
