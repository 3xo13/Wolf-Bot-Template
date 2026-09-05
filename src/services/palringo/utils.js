import { PalringoClientError } from './errors.js';

export const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export function asPositiveInteger (value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new PalringoClientError(`${name} must be a positive integer`, { value });
  }
  return number;
}

export function chunk (values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export function responseSucceeded (response) {
  if (response?.success === true) { return true; }
  const code = Number(response?.code);
  return Number.isFinite(code) && code >= 200 && code < 300;
}

export function packetBody (packet) {
  return packet?.body ?? packet;
}

export function requestEnvelope (payload) {
  if (payload === undefined) { return undefined; }
  if (payload && (Object.hasOwn(payload, 'headers') || Object.hasOwn(payload, 'body'))) {
    return payload;
  }
  return { body: payload };
}

export function decodeText (value) {
  if (Buffer.isBuffer(value)) { return value.toString('utf8').trim(); }
  if (value?.type === 'Buffer' && Array.isArray(value.data)) {
    return Buffer.from(value.data).toString('utf8').trim();
  }
  return value === undefined || value === null ? '' : String(value).trim();
}

export function normalizeEndpoint (host, port) {
  const rawHost = String(host || '').trim() || 'https://v3.palringo.com';
  const withProtocol = /^[a-z]+:\/\//iu.test(rawHost) ? rawHost : `https://${rawHost}`;
  const endpoint = new URL(withProtocol.replace(/^wss:/iu, 'https:').replace(/^ws:/iu, 'http:'));
  if (port) { endpoint.port = String(port); }
  endpoint.pathname = '/';
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString();
}
