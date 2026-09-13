import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { createProxyAgent } from '../palringo/transport/createProxyAgent.js';
import { normalizeEndpoint } from '../palringo/utils.js';

const DEFAULT_TIMEOUT = 20_000;

function sanitizedConnectionError (prefix, error) {
  const description = error?.description;
  const nestedMessages = description && typeof description === 'object'
    ? Object.getOwnPropertySymbols(description).map(symbol => description[symbol]?.message)
    : [];
  const message = String(
    nestedMessages.find(value => /unexpected server response|\b(?:401|403|429)\b/i.test(String(value))) ||
    error?.context?.message || description?.message || error?.message || ''
  ).trim();
  if (!message || /eyJ|WE-|appCheckToken=|token=/i.test(message)) {
    return new Error(`${prefix} failed`);
  }
  const safe = message.replace(/(?:https?|wss?):\/\/\S+/giu, '[redacted-url]');
  return new Error(`${prefix} failed: ${safe.slice(0, 160)}`);
}

function objectionMessage (objection) {
  const body = objection?.body ?? objection ?? {};
  const code = body.code ?? body.headers?.code;
  const subCode = body.subCode ?? body.headers?.subCode;
  return `WOLF rejected App Check verification (${code ?? 'unknown'}:${subCode ?? 'unknown'})`;
}

export async function verifyAppCheckConnection ({
  appCheckToken,
  accessToken = '',
  anonymousToken = '',
  targetType,
  proxy,
  host = 'https://v3-rc.palringo.com',
  port = 443,
  timeoutMs = DEFAULT_TIMEOUT,
  authenticatedDevice = 'mobile',
  socketFactory = io,
  signal
}) {
  const anonymous = targetType === 'classification';
  if (!appCheckToken) { throw new Error('App Check verification requires a token'); }
  if (!anonymous && !accessToken) {
    throw new Error('Authenticated App Check verification requires an account access token');
  }

  const agent = createProxyAgent(proxy);
  const options = {
    transports: ['websocket'],
    autoConnect: false,
    reconnection: false,
    timeout: timeoutMs,
    forceNew: true,
    multiplex: false,
    query: {
      device: anonymous ? 'web' : authenticatedDevice,
      token: anonymous ? (anonymousToken || `wjs-${randomUUID()}`) : accessToken,
      isAppCheckEnabled: 'true',
      appCheckToken
    },
    extraHeaders: { 'x-app-check-token': appCheckToken }
  };
  if (agent) { options.agent = agent; }

  const socket = socketFactory(normalizeEndpoint(host, port), options);
  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) { return; }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      socket.removeAllListeners?.();
      socket.io?.removeAllListeners?.();
      socket.disconnect?.();
      callback(value);
    };
    const onAbort = () => finish(reject, new Error('App Check acquisition was cancelled'));
    const timer = setTimeout(
      () => finish(reject, new Error('App Check verification timed out')),
      timeoutMs
    );
    timer.unref?.();

    socket.on('connect_error', error => finish(
      reject,
      sanitizedConnectionError('App Check verification connection', error)
    ));
    socket.on('objection', objection => finish(reject, new Error(objectionMessage(objection))));
    socket.on('welcome', welcome => {
      const subscriber = welcome?.loggedInUser ?? welcome?.subscriber;
      if (anonymous && subscriber?.id) {
        finish(reject, new Error('Anonymous App Check verification unexpectedly authenticated'));
        return;
      }
      if (!anonymous && !subscriber?.id) {
        finish(reject, new Error('The supplied account token did not receive an authenticated WOLF welcome'));
        return;
      }
      finish(resolve, { authenticated: !anonymous, subscriberId: subscriber?.id });
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    socket.connect?.();
  });
}

export default verifyAppCheckConnection;
