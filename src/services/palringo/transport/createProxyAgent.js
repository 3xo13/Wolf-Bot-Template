import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

export function createProxyAgent (proxy) {
  if (!proxy?.enabled || !proxy.host || !proxy.port) { return null; }

  const protocol = String(proxy.protocol || 'http').toLowerCase();
  const credentials = proxy.username && proxy.password
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
    : '';
  const proxyUrl = `${protocol}://${credentials}${proxy.host}:${proxy.port}`;

  return ['socks', 'socks5'].includes(protocol)
    ? new SocksProxyAgent(proxyUrl)
    : new HttpsProxyAgent(proxyUrl);
}

export default createProxyAgent;
