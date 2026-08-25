import { isPlatformPrivileged } from './platformPrivileges.js';

const PATCH_SIZE = 50;
const RETRY_DELAYS = [0, 1000, 3000];

const wait = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

function unwrapProfile (entry) {
  if (!entry || typeof entry !== 'object') { return null; }
  if (entry.success === false) { return null; }
  return entry.body && typeof entry.body === 'object' ? entry.body : entry;
}

function profilesById (body, requestedIds) {
  const result = new Map();
  const entries = Array.isArray(body) ? body : Object.values(body || {});
  entries.forEach((entry, index) => {
    const profile = unwrapProfile(entry);
    const id = Number(profile?.id ?? requestedIds[index]);
    if (Number.isInteger(id) && profile) { result.set(id, profile); }
  });
  return result;
}

async function requestProfiles (roomBot, ids, extended) {
  if (!roomBot?.connected) { throw new Error('Room bot is not connected'); }
  const response = await roomBot.websocket.emit('subscriber profile', {
    headers: { version: 4 },
    body: { idList: ids.map(Number), extended, subscribe: false }
  });
  if (!response?.success) { throw new Error(`Subscriber profile request failed (${response?.code ?? 'unknown'})`); }
  return profilesById(response.body, ids);
}

async function fetchPrivileges (roomBot, ids) {
  const compact = await requestProfiles(roomBot, ids, false);
  const privileges = new Map();
  const missing = [];

  ids.forEach(id => {
    const profile = compact.get(Number(id));
    if (Number.isInteger(profile?.privileges)) { privileges.set(String(id), profile.privileges); } else { missing.push(id); }
  });

  if (missing.length) {
    const extended = await requestProfiles(roomBot, missing, true);
    missing.forEach(id => {
      const profile = extended.get(Number(id));
      if (Number.isInteger(profile?.privileges)) { privileges.set(String(id), profile.privileges); }
    });
  }
  return privileges;
}

export async function classifySubscriberPatch (botManager, roomBot, subscriberIds, options = {}) {
  const ids = [...new Set(subscriberIds.map(String))].slice(0, PATCH_SIZE);
  const attempts = options.attempts ?? 3;
  const unresolved = new Set(ids);
  const generation = botManager._classificationGeneration;

  const previousState = botManager.classificationState;
  ids.forEach(id => {
    botManager.classifyingUsers.add(id);
    botManager.unknownUsers.delete(id);
  });
  botManager.emitClassificationStatus(previousState === 'idle' ? 'classifying' : previousState);

  try {
    for (let attempt = 0; attempt < attempts && unresolved.size; attempt++) {
      if (botManager.isClassificationCancelled(generation)) { break; }
      if (RETRY_DELAYS[attempt]) { await wait(RETRY_DELAYS[attempt]); }
      try {
        const privileges = await fetchPrivileges(roomBot, [...unresolved]);
        if (botManager.isClassificationCancelled(generation)) { break; }
        for (const [id, mask] of privileges) {
          unresolved.delete(id);
          botManager.classifyUser(id, isPlatformPrivileged(mask));
        }
      } catch (error) {
        console.warn(`Subscriber classification attempt ${attempt + 1} failed:`, error.message);
      }
    }

    if (!botManager.isClassificationCancelled(generation)) {
      unresolved.forEach(id => botManager.markUserUnknown(id));
    }
    return {
      eligible: ids.filter(id => botManager.eligibleUsers.has(id)),
      excluded: ids.filter(id => botManager.excludedUsers.has(id)),
      unknown: [...unresolved],
      cancelled: botManager.isClassificationCancelled(generation)
    };
  } finally {
    ids.forEach(id => botManager.classifyingUsers.delete(id));
    botManager.emitClassificationStatus(previousState);
    botManager.signalRecipientChange();
  }
}

export { PATCH_SIZE };
