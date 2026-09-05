export class PalringoClientError extends Error {
  constructor (message, details = {}) {
    super(message);
    this.name = this.constructor.name;
    Object.assign(this, details);
  }
}

export class PalringoConnectionError extends PalringoClientError {}

export class PalringoAuthenticationError extends PalringoClientError {}

export class PalringoRequestError extends PalringoClientError {
  constructor (message, { command, response, attempt, cause } = {}) {
    super(message, {
      command,
      response,
      attempt,
      cause,
      code: response?.code ?? cause?.code
    });
  }
}
