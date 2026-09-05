import { DEFAULT_CONNECTION, RETRYABLE_RESPONSE_CODES } from '../constants.js';
import { PalringoRequestError } from '../errors.js';
import { delay, requestEnvelope, responseSucceeded } from '../utils.js';

export default class RequestDispatcher {
  constructor (transport, config = {}) {
    this.transport = transport;
    this.maxAttempts = config.maxRequestAttempts ?? DEFAULT_CONNECTION.maxRequestAttempts;
    this.retryDelay = config.retryDelay ?? DEFAULT_CONNECTION.retryDelay;
    this.retryableCodes = new Set(config.retryableResponseCodes || RETRYABLE_RESPONSE_CODES);
  }

  async request (command, payload, options = {}) {
    const requestedAttempts = Number(options.maxAttempts ?? this.maxAttempts);
    const maxAttempts = Number.isFinite(requestedAttempts)
      ? Math.max(1, Math.floor(requestedAttempts))
      : 1;
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.transport.emitWithAck(
          command,
          requestEnvelope(payload),
          { timeout: options.timeout }
        );
        if (responseSucceeded(response)) { return response; }

        lastError = new PalringoRequestError(`Request failed: ${command}`, {
          command,
          response,
          attempt
        });
        if (!this.retryableCodes.has(Number(response?.code)) || attempt === maxAttempts) {
          throw lastError;
        }
      } catch (error) {
        if (error === lastError || attempt === maxAttempts || options.retryTransportErrors !== true) {
          throw error instanceof PalringoRequestError
            ? error
            : new PalringoRequestError(`Request failed: ${command}`, { command, attempt, cause: error });
        }
        lastError = error;
      }

      const retryDelay = Number(options.retryDelay ?? this.retryDelay) * attempt;
      if (retryDelay > 0) { await delay(retryDelay); }
    }

    throw lastError;
  }
}
