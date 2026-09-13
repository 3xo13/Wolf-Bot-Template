import { spawn, execFile } from 'node:child_process';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { findBrowserExecutable } from './browserExecutable.js';
import { inspectAppCheckToken } from './token.js';
import { verifyAppCheckConnection } from './verifyAppCheckConnection.js';

const WOLF_WEB_URL = 'https://app.wolf.live/';
const DEFAULT_TIMEOUT = 90_000;
const PROFILE_ROOT = path.join(os.tmpdir(), 'wolf-bot-app-check');
const PAGE_RECOVERY_POLL_MS = 1000;
const PAGE_RELOAD_INTERVAL_MS = 15000;
const RECONNECT_CLICK_INTERVAL_MS = 5000;
const MAX_BROWSER_ATTEMPTS = 3;
const MAX_VERIFICATION_ATTEMPTS = 3;
const VERIFICATION_RETRY_DELAYS_MS = [3000, 5000];

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function freeLoopbackPort () {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function terminateOwnedProcessTree (child) {
  if (!child) { return; }
  if (process.platform === 'win32') {
    // Chrome can detach its real browser process from the Node child. Always
    // terminate the launched PID's owned tree, even when the child has exited.
    await new Promise(resolve => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => resolve()));
  } else {
    if (child.exitCode !== null) { return; }
    try { child.kill('SIGTERM'); } catch {}
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), wait(2000)]);
    if (child.exitCode === null) { try { child.kill('SIGKILL'); } catch {} }
  }
}

async function removeProfileWithRetry (profile, filesystem = { rm }) {
  for (const delay of [0, 250, 750, 1500, 3000]) {
    if (delay) { await wait(delay); }
    try {
      await filesystem.rm(profile, { recursive: true, force: true });
      return;
    } catch {}
  }
}

function tokenFromUrl (rawUrl) {
  try { return new URL(rawUrl).searchParams.get('appCheckToken'); } catch { return null; }
}

function anonymousTokenFromUrl (rawUrl) {
  try {
    const token = new URL(rawUrl).searchParams.get('token') || '';
    return token.startsWith('wjs-') ? token : '';
  } catch { return ''; }
}

function wolfConnectionFromUrl (rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!/(?:^|\.)palringo\.com$/iu.test(url.hostname)) { return null; }
    return {
      host: url.hostname,
      port: Number(url.port) || 443,
      device: url.searchParams.get('device') || '',
      state: url.searchParams.get('state') || '',
      version: url.searchParams.get('version') || ''
    };
  } catch { return null; }
}

function socketIoEventName (payload) {
  const value = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload || '');
  if (!value.startsWith('42')) { return ''; }
  try {
    const packet = JSON.parse(value.slice(2));
    return Array.isArray(packet) ? String(packet[0] || '') : '';
  } catch { return ''; }
}

class GlobalAcquisitionSemaphore {
  constructor (limit = 2) { this.limit = limit; this.active = 0; this.queue = []; }
  async run (task, onProgress, signal) {
    await new Promise((resolve, reject) => {
      const entry = {
        reject,
        onProgress,
        resolve: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }
      };
      const onAbort = () => {
        const index = this.queue.indexOf(entry);
        if (index < 0) { return; }
        this.queue.splice(index, 1);
        this.publish();
        reject(new Error('App Check acquisition was cancelled'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.queue.push(entry);
      this.publish();
      this.drain();
    });
    onProgress?.({ state: 'active', active: this.active, queued: this.queue.length });
    try { return await task(); } finally {
      this.active--;
      onProgress?.({ state: 'done', active: this.active, queued: this.queue.length });
      this.publish();
      this.drain();
    }
  }

  drain () {
    while (this.active < this.limit && this.queue.length) {
      const entry = this.queue.shift();
      this.active++;
      entry.resolve();
      this.publish();
    }
  }

  publish () {
    for (const entry of this.queue) { entry.onProgress?.({ state: 'queued', active: this.active, queued: this.queue.length }); }
  }
}

const globalSemaphore = new GlobalAcquisitionSemaphore(2);

export default class BrowserAppCheckAcquirer {
  constructor ({
    browserExecutable = findBrowserExecutable,
    processLauncher = spawn,
    cdpConnector = (...args) => chromium.connectOverCDP(...args),
    filesystem = { mkdir, readdir, rm, stat },
    portProvider = freeLoopbackPort,
    processTerminator = terminateOwnedProcessTree,
    clock = () => Date.now(),
    profileRoot = PROFILE_ROOT,
    timeoutMs = DEFAULT_TIMEOUT,
    semaphore = globalSemaphore,
    tokenVerifier = verifyAppCheckConnection
  } = {}) {
    Object.assign(this, { browserExecutable, processLauncher, cdpConnector, filesystem, portProvider, processTerminator, clock, profileRoot, timeoutMs, semaphore, tokenVerifier });
  }

  async acquire ({ proxy, accessToken, anonymousToken, targetType, signal, onProgress } = {}) {
    return await this.semaphore.run(
      async () => {
        const overallDeadline = this.clock() + this.timeoutMs;
        let lastError;
        for (let attempt = 1; attempt <= MAX_BROWSER_ATTEMPTS; attempt++) {
          const timeLeft = overallDeadline - this.clock();
          if (timeLeft <= 0) { break; }
          const attemptsLeft = MAX_BROWSER_ATTEMPTS - attempt + 1;
          const attemptTimeoutMs = attempt === MAX_BROWSER_ATTEMPTS
            ? timeLeft
            : Math.min(30000, Math.max(10000, Math.floor(timeLeft / attemptsLeft)));
          try {
            return await this.acquireOwnedBrowser({
              proxy, accessToken, anonymousToken, targetType, signal, timeoutMs: attemptTimeoutMs
            });
          } catch (error) {
            if (signal?.aborted || /cancelled/i.test(String(error?.message || ''))) { throw error; }
            lastError = error;
            if (attempt < MAX_BROWSER_ATTEMPTS && overallDeadline > this.clock()) {
              onProgress?.({ state: 'retrying-browser', attempt: attempt + 1, maximumAttempts: MAX_BROWSER_ATTEMPTS });
            }
          }
        }
        throw lastError || new Error('App Check acquisition timed out');
      },
      onProgress,
      signal
    );
  }

  async acquireOwnedBrowser ({ proxy, accessToken, anonymousToken, targetType, signal, timeoutMs = this.timeoutMs }) {
    if (signal?.aborted) { throw new Error('App Check acquisition was cancelled'); }
    if (targetType !== 'classification' && !String(accessToken || '').trim()) {
      throw new Error('App Check acquisition requires the account access token');
    }
    const deadline = this.clock() + timeoutMs;
    const remaining = () => {
      const value = deadline - this.clock();
      if (value <= 0) { throw new Error('App Check acquisition timed out'); }
      return value;
    };
    const executable = this.browserExecutable();
    const port = await this.portProvider();
    const profile = path.join(this.profileRoot, `act-${this.clock()}-${randomUUID()}`);
    await this.filesystem.mkdir(profile, { recursive: true });
    const args = [
      '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'
    ];
    if (proxy?.enabled) { args.unshift(`--proxy-server=http://${proxy.host}:${proxy.port}`); }
    let child;
    let browser;
    let timeout;
    let abortHandler;
    let cleanedUp = false;
    const cleanupOwnedBrowser = async () => {
      if (cleanedUp) { return; }
      cleanedUp = true;
      try {
        const session = await browser?.newBrowserCDPSession?.();
        await session?.send?.('Browser.close');
      } catch {}
      try { await browser?.close(); } catch {}
      await this.processTerminator(child);
      await removeProfileWithRetry(profile, this.filesystem);
      browser = null;
      child = null;
    };
    try {
      child = this.processLauncher(executable, args, {
        detached: false, windowsHide: false, stdio: 'ignore'
      });
      let launchError = null;
      child.once?.('error', error => { launchError = error; });
      child.once?.('exit', code => {
        if (code !== null) { launchError ||= new Error(`Browser exited before App Check acquisition completed (${code})`); }
      });
      const aborted = new Promise((_, reject) => {
        if (signal?.aborted) {
          reject(new Error('App Check acquisition was cancelled'));
          return;
        }
        abortHandler = () => reject(new Error('App Check acquisition was cancelled'));
        signal?.addEventListener('abort', abortHandler, { once: true });
      });
      const endpoint = `http://127.0.0.1:${port}`;
      while (this.clock() < deadline) {
        if (signal?.aborted) { throw new Error('App Check acquisition was cancelled'); }
        if (launchError) { throw launchError; }
        if (child.exitCode !== null) { throw new Error('Browser exited before App Check acquisition completed'); }
        try { const response = await fetch(`${endpoint}/json/version`); if (response.ok) { break; } } catch {}
        await wait(200);
      }
      if (this.clock() >= deadline) { throw new Error('Browser debugging connection timed out'); }
      browser = await Promise.race([
        this.cdpConnector(endpoint, { timeout: remaining() }),
        aborted
      ]);
      const context = browser.contexts()[0];
      if (!context) { throw new Error('Browser did not expose a usable context'); }
      let resolveCapture;
      let rejectCapture;
      const captured = new Promise((resolve, reject) => { resolveCapture = resolve; rejectCapture = reject; });
      const acceptToken = (token, source, capturedAnonymousToken = '', wolfConnection = null) => {
        if (!token) { return false; }
        const pairedAnonymousToken = capturedAnonymousToken || anonymousToken;
        if (targetType === 'classification' && !pairedAnonymousToken) { return false; }
        try {
          resolveCapture({
            token,
            source,
            anonymousToken: pairedAnonymousToken,
            wolfConnection,
            ...inspectAppCheckToken(token, { now: this.clock() })
          });
          return true;
        } catch {
          return false;
        }
      };
      const inspectWebSocket = webSocket => {
        const url = webSocket.url();
        const wolfConnection = wolfConnectionFromUrl(url);
        if (!wolfConnection) { return; }
        const token = tokenFromUrl(url);
        const capturedAnonymousToken = anonymousTokenFromUrl(url);
        if (!token) { return; }
        // A WebSocket object is exposed before its HTTP upgrade is accepted.
        // Treating creation as success captured ACTs from the Connection Lost
        // screen. Wait for WOLF's welcome frame so the ACT/identity pair is
        // known to have completed a real platform handshake.
        webSocket.on('framereceived', ({ payload }) => {
          if (socketIoEventName(payload) !== 'welcome') { return; }
          acceptToken(token, 'wolf-welcome', capturedAnonymousToken, wolfConnection);
        });
      };
      if (targetType !== 'classification') {
        await context.routeWebSocket(/(?:^|\.)palringo\.com/iu, async webSocket => {
          const url = webSocket.url();
          const wolfConnection = wolfConnectionFromUrl(url);
          if (wolfConnection) {
            // Do not connect the browser's anonymous WOLF socket. Capture the
            // minted ACT from its request and let the authenticated account be
            // the first subscriber that presents it to the platform.
            acceptToken(tokenFromUrl(url), 'wolf-auth-preflight', '', wolfConnection);
          }
          await webSocket.close({ code: 1000, reason: 'Authenticated ACT captured' });
        });
      }
      const observePage = page => {
        page.on('websocket', inspectWebSocket);
      };
      context.pages().forEach(observePage);
      context.on('page', observePage);
      const page = context.pages()[0] || await context.newPage();
      timeout = setTimeout(() => rejectCapture(new Error('App Check acquisition timed out')), remaining());
      await Promise.race([
        page.goto(WOLF_WEB_URL, { waitUntil: 'domcontentloaded', timeout: remaining() }),
        aborted
      ]);
      let lastReloadAt = this.clock();
      let lastReconnectClickAt = 0;
      let result;
      while (!result) {
        const outcome = await Promise.race([
          captured.then(value => ({ captured: value })),
          aborted,
          wait(Math.min(PAGE_RECOVERY_POLL_MS, remaining())).then(() => null)
        ]);
        if (outcome?.captured) {
          result = outcome.captured;
          break;
        }

        const now = this.clock();
        let clickedReconnect = false;
        if (now - lastReconnectClickAt >= RECONNECT_CLICK_INTERVAL_MS) {
          try {
            const reconnect = page.getByRole('button', { name: /reconnect/i }).first();
            if (await reconnect.isVisible({ timeout: 250 })) {
              await reconnect.click({ timeout: 2000 });
              lastReconnectClickAt = now;
              clickedReconnect = true;
            }
          } catch {}
        }
        if (!clickedReconnect && now - lastReloadAt >= PAGE_RELOAD_INTERVAL_MS) {
          try {
            await Promise.race([
              page.reload({ waitUntil: 'domcontentloaded', timeout: Math.min(15000, remaining()) }),
              aborted
            ]);
          } catch (error) {
            if (signal?.aborted) { throw error; }
          }
          lastReloadAt = this.clock();
        }
      }
      clearTimeout(timeout);
      timeout = null;

      // A classifier reuses the exact anonymous identity from the browser, so
      // keeping that welcome alive makes its validation deterministic. For an
      // authenticated record the browser socket was intercepted before it
      // reached WOLF; close Chrome before the account token claims the ACT.
      if (targetType !== 'classification') {
        await cleanupOwnedBrowser();
      }

      let verificationError;
      for (let attempt = 0; attempt < MAX_VERIFICATION_ATTEMPTS; attempt++) {
        try {
          await Promise.race([
            this.tokenVerifier({
              appCheckToken: result.token,
              accessToken,
              anonymousToken: result.anonymousToken || anonymousToken,
              targetType,
              proxy,
              host: result.wolfConnection?.host
                ? `https://${result.wolfConnection.host}`
                : undefined,
              port: result.wolfConnection?.port,
              timeoutMs: Math.min(20_000, remaining()),
              signal
            }),
            aborted
          ]);
          verificationError = null;
          break;
        } catch (error) {
          if (signal?.aborted) { throw error; }
          verificationError = error;
          const retryDelay = VERIFICATION_RETRY_DELAYS_MS[attempt];
          if (!retryDelay || deadline - this.clock() <= retryDelay) { break; }
          await Promise.race([wait(retryDelay), aborted]);
        }
      }
      if (verificationError) { throw verificationError; }
      return result;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortHandler);
      await cleanupOwnedBrowser();
    }
  }

  async sweepStaleProfiles ({ olderThanMs = 60 * 60 * 1000 } = {}) {
    try {
      const entries = await this.filesystem.readdir(this.profileRoot, { withFileTypes: true });
      await Promise.allSettled(entries.filter(entry => entry.isDirectory()).map(async entry => {
        const target = path.join(this.profileRoot, entry.name);
        const info = await this.filesystem.stat(target);
        if (this.clock() - info.mtimeMs > olderThanMs) { await removeProfileWithRetry(target, this.filesystem); }
      }));
    } catch {}
  }
}

export const defaultAppCheckAcquirer = new BrowserAppCheckAcquirer();
