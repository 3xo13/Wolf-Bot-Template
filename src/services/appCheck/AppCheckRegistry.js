import { createHash, randomUUID } from 'node:crypto';
import { defaultAppCheckAcquirer } from './BrowserAppCheckAcquirer.js';
import { normalizeAppCheckProxy, proxyFingerprint } from './proxy.js';
import { isAppCheckTokenUsable } from './token.js';

const EARLY_REFRESH_MS = 5 * 60 * 1000;
const MINIMUM_TIMER_MS = 1000;

export function appCheckRecordId (type, index = 0) {
  return type === 'classification' || type === 'main' ? type : `${type}:${index}`;
}

function configFingerprint (accessToken, proxy) {
  return createHash('sha256')
    .update(`${String(accessToken || '')}\0${proxyFingerprint(proxy)}`)
    .digest('hex');
}

function safeMessage (error, fallback = 'تعذر الحصول على رمز التحقق من المنصة.') {
  const message = String(error?.message || '').trim();
  if (!message || /eyJ|WE-|appCheckToken=|token=/i.test(message)) { return fallback; }
  return message.slice(0, 300);
}

export default class AppCheckRegistry {
  constructor (manager, {
    acquirer = defaultAppCheckAcquirer,
    clock = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout
  } = {}) {
    this.manager = manager;
    this.acquirer = acquirer;
    this.clock = clock;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.records = new Map();
    this.consumers = new Map();
    this.generation = 0;
    this.destroyed = false;
    this.completed = 0;
    this.total = 0;
    this.active = 0;
    this.queued = 0;
  }

  get (type, index = 0) { return this.records.get(appCheckRecordId(type, index)); }

  emitStatus (record, message) {
    const payload = {
      target: record?.type || 'all',
      accountNumber: record && !['main', 'classification'].includes(record.type) ? record.index + 1 : undefined,
      recordId: record?.id,
      state: record?.state || 'idle',
      expiresAt: record?.expiresAt || null,
      message: message || record?.message || '',
      paused: this.manager.isAppCheckPaused(),
      progress: {
        completed: this.completed,
        total: this.total,
        active: this.active,
        queued: this.queued
      }
    };
    this.manager.emit('app-check:status', payload);
  }

  createOrReplace ({ type, index = 0, accessToken = '', proxy }) {
    const id = appCheckRecordId(type, index);
    const normalizedProxy = normalizeAppCheckProxy(proxy);
    const signature = configFingerprint(accessToken, normalizedProxy);
    const existing = this.records.get(id);
    if (existing?.configFingerprint === signature) { return existing; }
    if (existing) { this.invalidateRecord(existing); }
    const record = {
      id,
      type,
      index,
      accessToken,
      anonymousToken: type === 'classification' ? `wjs-${randomUUID()}` : '',
      wolfConnection: null,
      proxy: normalizedProxy,
      configFingerprint: signature,
      token: '',
      fingerprint: '',
      issuedAt: 0,
      expiresAt: 0,
      state: 'idle',
      generation: 0,
      task: null,
      refreshTimer: null,
      expiryTimer: null,
      continuations: new Map(),
      resumeContinuations: false,
      warningAcknowledged: false,
      finalAttemptedExpiry: 0,
      consumed: false,
      message: '',
      abortController: null
    };
    this.records.set(id, record);
    return record;
  }

  addContinuation (record, key, continuation) {
    if (key && typeof continuation === 'function') { record.continuations.set(key, continuation); }
  }

  async ensure (target, { continuationKey, continuation, force = false } = {}) {
    if (this.destroyed) { throw new Error('App Check manager is closed'); }
    const record = this.createOrReplace(target);
    this.addContinuation(record, continuationKey, continuation);
    if (!force && isAppCheckTokenUsable(record, this.clock())) {
      if (continuationKey) { record.continuations.delete(continuationKey); }
      return record;
    }
    const result = record.task ? await record.task : await this.acquireRecord(record);
    if (!record.resumeContinuations && continuationKey) { record.continuations.delete(continuationKey); }
    return result;
  }

  async acquireRecord (record, { proactive = false, duplicateRetry = false } = {}) {
    const registryGeneration = this.generation;
    const recordGeneration = ++record.generation;
    record.state = proactive ? 'refreshing' : 'acquiring';
    record.message = '';
    this.total++;
    this.queued++;
    this.emitStatus(record);
    const abortController = new AbortController();
    record.abortController = abortController;
    let progressState = 'queued';
    const task = (async () => {
      try {
        const result = await this.acquirer.acquire({
          proxy: record.proxy,
          accessToken: record.accessToken,
          anonymousToken: record.anonymousToken,
          targetType: record.type,
          accountIndex: record.index,
          signal: abortController.signal,
          onProgress: progress => {
            if (progress?.state === 'active') {
              if (progressState === 'queued') {
                this.queued = Math.max(0, this.queued - 1);
                this.active++;
              }
              progressState = 'active';
            } else if (progress?.state === 'done') {
              if (progressState === 'active') { this.active = Math.max(0, this.active - 1); }
              progressState = 'done';
            }
            this.emitStatus(record);
          }
        });
        if (this.destroyed || registryGeneration !== this.generation || recordGeneration !== record.generation) {
          throw new Error('Stale App Check acquisition result');
        }
        const duplicate = [...this.records.values()].find(other =>
          other !== record && other.fingerprint && other.fingerprint === result.fingerprint
        );
        if (duplicate && !duplicateRetry) {
          return await this.acquireRecordAfterCurrent(record, { duplicateRetry: true });
        }
        if (duplicate) { throw new Error('The browser returned the same App Check identity for separate account records'); }
        record.token = result.token;
        if (record.type === 'classification' && result.anonymousToken) {
          record.anonymousToken = result.anonymousToken;
        }
        record.wolfConnection = result.wolfConnection || null;
        record.fingerprint = result.fingerprint;
        record.issuedAt = result.issuedAt;
        record.expiresAt = result.expiresAt;
        record.state = 'ready';
        record.warningAcknowledged = false;
        record.finalAttemptedExpiry = 0;
        record.message = '';
        this.schedule(record);
        this.updateConsumers(record);
        this.manager.removeAppCheckPauseReason(record.id);
        this.emitStatus(record);
        if (record.resumeContinuations) {
          record.resumeContinuations = false;
          await this.runContinuations(record);
        }
        return record;
      } catch (error) {
        if (this.destroyed || registryGeneration !== this.generation || recordGeneration !== record.generation) {
          const cancelled = new Error('App Check acquisition was cancelled');
          cancelled.code = 'APP_CHECK_CANCELLED';
          throw cancelled;
        }
        if (proactive && record.token && record.expiresAt > this.clock()) {
          record.state = 'warning';
          record.message = safeMessage(error, 'فشل التحديث المبكر لرمز التحقق. سيستمر الاتصال حتى انتهاء الرمز الحالي.');
          this.scheduleExpiryOnly(record);
          await this.warn(record, record.message);
        } else {
          record.token = '';
          record.fingerprint = '';
          record.state = 'retry-required';
          record.message = safeMessage(error);
          record.resumeContinuations = record.continuations.size > 0;
          this.pauseConsumers(record);
          this.emitStatus(record);
        }
        const wrapped = new Error(record.message || safeMessage(error));
        wrapped.code = 'APP_CHECK_ACQUISITION_FAILED';
        wrapped.recordId = record.id;
        wrapped.cause = error;
        throw wrapped;
      } finally {
        if (progressState === 'queued') { this.queued = Math.max(0, this.queued - 1); }
        if (progressState === 'active') { this.active = Math.max(0, this.active - 1); }
        progressState = 'done';
        this.completed++;
        if (record.task === task) { record.task = null; }
        if (record.abortController === abortController) { record.abortController = null; }
        if (!this.destroyed && this.records.get(record.id) === record) { this.emitStatus(record); }
      }
    })();
    record.task = task;
    return await task;
  }

  async acquireRecordAfterCurrent (record, options) {
    // Avoid recursively observing record.task while performing the one allowed
    // sequential duplicate-identity retry.
    record.task = null;
    return await this.acquireRecord(record, options);
  }

  schedule (record) {
    this.clearRecordTimers(record);
    const refreshDelay = Math.max(MINIMUM_TIMER_MS, record.expiresAt - EARLY_REFRESH_MS - this.clock());
    record.refreshTimer = this.setTimer(() => this.handleEarlyRefresh(record.id, record.generation), refreshDelay);
    record.refreshTimer?.unref?.();
  }

  scheduleExpiryOnly (record) {
    this.clearTimer(record.expiryTimer);
    const delay = Math.max(MINIMUM_TIMER_MS, record.expiresAt - this.clock());
    record.expiryTimer = this.setTimer(() => this.handleExpiry(record.id, record.generation), delay);
    record.expiryTimer?.unref?.();
  }

  async handleEarlyRefresh (id, generation) {
    const record = this.records.get(id);
    if (!record || record.generation !== generation || this.destroyed) { return; }
    const remaining = record.expiresAt - this.clock();
    if (remaining > EARLY_REFRESH_MS + 1000) { this.schedule(record); return; }
    if (remaining <= 0) { await this.handleExpiry(id, generation); return; }
    try { await this.acquireRecord(record, { proactive: true }); } catch {}
  }

  async handleExpiry (id, generation) {
    const record = this.records.get(id);
    if (!record || record.generation !== generation || this.destroyed) { return; }
    if (record.task) {
      try { await record.task; } catch {}
      return;
    }
    if (record.expiresAt > this.clock()) { this.scheduleExpiryOnly(record); return; }
    // An expiry receives one automatic recovery attempt. A failed acknowledged
    // main retry is deliberately left paused for the operator rather than
    // silently starting another browser acquisition when the old timer fires.
    if ((record.warningAcknowledged && record.state === 'retry-required') ||
      (record.finalAttemptedExpiry === record.expiresAt && record.state === 'retry-required')) {
      return;
    }
    record.finalAttemptedExpiry = record.expiresAt;
    record.token = '';
    record.fingerprint = '';
    this.pauseConsumers(record);
    const required = this.manager.isAppCheckRecordRequired(record);
    if (required) { this.manager.addAppCheckPauseReason(record.id); }
    try {
      await this.acquireRecord(record);
    } catch (error) {
      if (!required) { return; }
      if (record.type === 'main' && !record.warningAcknowledged) {
        if (this.manager.hasActiveHelperWork()) {
          await this.manager.handleFatalAppCheckFailure(record, error);
        } else {
          await this.manager.disconnectIdleMainForAppCheck(record);
        }
      }
    }
  }

  async refreshExpiredRequiredRecords () {
    for (const record of this.records.values()) {
      if (record.expiresAt > this.clock() || record.task || !this.manager.isAppCheckRecordRequired(record)) { continue; }
      await this.handleExpiry(record.id, record.generation);
    }
  }

  handleConsumerUnavailable (recordId) {
    const record = this.records.get(recordId);
    if (!record || record.task || this.destroyed) { return; }
    if (record.expiresAt <= this.clock()) {
      this.handleExpiry(record.id, record.generation).catch(() => {});
    }
  }

  async retryFailed ({ acknowledgeMain = false } = {}) {
    const candidates = [...this.records.values()].filter(record =>
      ['warning', 'retry-required'].includes(record.state)
    );
    if (acknowledgeMain) {
      const main = this.records.get('main');
      if (main) { main.warningAcknowledged = true; }
      this.manager.addAppCheckPauseReason('manual-main-retry');
    }
    const failures = [];
    for (const record of candidates) {
      if (record.type === 'main' && record.state === 'warning' && !acknowledgeMain && record.expiresAt > this.clock()) { continue; }
      try {
        if (record.type !== 'main' && record.state === 'warning' && record.expiresAt > this.clock()) {
          await this.acquireRecord(record, { proactive: true });
        } else {
          await this.ensure(record, { force: true });
        }
      } catch (error) { failures.push(error); }
    }
    if (!failures.length) {
      this.manager.removeAppCheckPauseReason('manual-main-retry');
      this.emitSnapshot();
    }
    return { failures };
  }

  registerConsumer (recordId, consumer) {
    if (!recordId || !consumer) { return; }
    if (!this.consumers.has(recordId)) { this.consumers.set(recordId, new Set()); }
    this.consumers.get(recordId).add(consumer);
    consumer._appCheckRecordId = recordId;
  }

  unregisterConsumer (consumer) {
    const id = consumer?._appCheckRecordId;
    if (id) { this.consumers.get(id)?.delete(consumer); }
  }

  updateConsumers (record) {
    for (const consumer of this.consumers.get(record.id) || []) {
      consumer.replaceAppCheckToken?.(record.token, record.expiresAt);
    }
  }

  pauseConsumers (record) {
    for (const consumer of this.consumers.get(record.id) || []) { consumer.pauseForAppCheck?.(); }
  }

  async runContinuations (record) {
    const continuations = [...record.continuations.values()];
    record.continuations.clear();
    for (const continuation of continuations) {
      if (!this.destroyed) { await continuation(); }
    }
  }

  async warn (record, message) {
    this.emitStatus(record, message);
    const main = this.manager.getMainBot();
    if (!main?.connected) { return; }
    try {
      const { sendPrivateMessage } = await import('../utils/messaging/sendPrivateMessage.js');
      const action = record.type === 'main'
        ? '\nيمكنك إرسال: إيقاف مؤقت وإعادة محاولة التحقق'
        : '\nيمكنك إرسال: إعادة محاولة التحقق';
      await sendPrivateMessage(this.manager.config.baseConfig.orderFrom, `${message}${action}`, main, main);
    } catch {}
  }

  markConsumed (type, index = 0) { const record = this.get(type, index); if (record) { record.consumed = true; } }

  clearRecordTimers (record) {
    this.clearTimer(record.refreshTimer);
    this.clearTimer(record.expiryTimer);
    record.refreshTimer = null;
    record.expiryTimer = null;
  }

  invalidateRecord (record) {
    this.clearRecordTimers(record);
    record.abortController?.abort();
    record.abortController = null;
    record.generation++;
    record.token = '';
    record.fingerprint = '';
    record.state = 'invalidated';
    record.continuations.clear();
    for (const consumer of this.consumers.get(record.id) || []) { consumer.pauseForAppCheck?.(); }
    this.consumers.delete(record.id);
    this.manager.removeAppCheckPauseReason(record.id);
  }

  invalidateTypes (types) {
    for (const record of [...this.records.values()]) {
      if (types.includes(record.type)) {
        this.invalidateRecord(record);
        this.records.delete(record.id);
      }
    }
  }

  emitSnapshot () {
    this.manager.emit('app-check:status', {
      target: 'all',
      recordId: 'all',
      state: 'idle',
      expiresAt: null,
      message: '',
      paused: this.manager.isAppCheckPaused(),
      replace: true,
      progress: {
        completed: this.completed,
        total: this.total,
        active: this.active,
        queued: this.queued
      }
    });
    for (const record of this.records.values()) { this.emitStatus(record); }
  }

  async destroy ({ waitForAcquisitions = true } = {}) {
    this.destroyed = true;
    this.generation++;
    const tasks = [...this.records.values()].map(record => record.task).filter(Boolean);
    for (const record of this.records.values()) { this.invalidateRecord(record); }
    this.records.clear();
    this.consumers.clear();
    if (waitForAcquisitions) { await Promise.allSettled(tasks); }
  }
}
