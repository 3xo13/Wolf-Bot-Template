export function normalizeAppCheckProxy (value = {}) {
  const source = value?.proxy || value || {};
  if (source.enabled === false) { return Object.freeze({ enabled: false, host: '', port: 0 }); }
  const host = String(source.host || source.ipAddress || '').trim();
  const rawPort = source.port;
  const hasPort = rawPort !== undefined && rawPort !== null && String(rawPort).trim() !== '';
  if (!host || !hasPort) { return Object.freeze({ enabled: false, host: '', port: 0 }); }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid proxy port. Expected a value from 1 through 65535.');
  }
  return Object.freeze({ enabled: true, host, port, protocol: 'http' });
}

export function proxyFingerprint (proxy) {
  return proxy?.enabled ? `http://${proxy.host}:${proxy.port}` : 'direct';
}
