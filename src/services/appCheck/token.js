import { createHash } from 'node:crypto';

export const APP_CHECK_EXPECTATIONS = Object.freeze({
  algorithm: 'RS256',
  issuer: 'https://firebaseappcheck.googleapis.com/390750556641',
  audience: ['projects/390750556641', 'projects/palringo-client'],
  subject: '1:390750556641:web:dfa97389209978e935c2a0',
  provider: 'recaptcha_enterprise'
});

function decodePart (part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

export function fingerprintAppCheckToken (token) {
  return createHash('sha256').update(String(token)).digest('hex').slice(0, 16);
}

export function inspectAppCheckToken (token, {
  now = Date.now(),
  minimumValidityMs = 10 * 60 * 1000,
  clockSkewMs = 5 * 60 * 1000
} = {}) {
  try {
    const [headerPart, payloadPart, signature] = String(token || '').split('.');
    if (!headerPart || !payloadPart || !signature) { throw new Error('Malformed JWT'); }
    const header = decodePart(headerPart);
    const payload = decodePart(payloadPart);
    const issuedAt = Number(payload.iat) * 1000;
    const expiresAt = Number(payload.exp) * 1000;
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const expectedAudience = APP_CHECK_EXPECTATIONS.audience.some(value => audience.includes(value));
    const valid = header.alg === APP_CHECK_EXPECTATIONS.algorithm &&
      payload.iss === APP_CHECK_EXPECTATIONS.issuer &&
      payload.sub === APP_CHECK_EXPECTATIONS.subject &&
      payload.provider === APP_CHECK_EXPECTATIONS.provider &&
      expectedAudience && Number.isFinite(issuedAt) && Number.isFinite(expiresAt) &&
      issuedAt <= now + clockSkewMs && expiresAt > issuedAt && expiresAt - now >= minimumValidityMs;
    if (!valid) { throw new Error('Captured App Check token did not match the expected WOLF application'); }
    return { issuedAt, expiresAt, fingerprint: fingerprintAppCheckToken(token), header, payload };
  } catch (error) {
    const safeError = new Error('Invalid App Check token');
    safeError.cause = error;
    throw safeError;
  }
}

export function isAppCheckTokenUsable (record, now = Date.now()) {
  return ['ready', 'refreshing', 'warning'].includes(record?.state) &&
    Boolean(record.token) && Number(record.expiresAt) > now;
}
