// The one error type every provider client throws, in its own module so the clients can share it
// without importing each other (provider.js routes to jev.js).
export class ProviderError extends Error {
  constructor(message, { status = 0, retryable = false, body } = {}) {
    super(message); this.name = 'ProviderError'; this.status = status; this.retryable = retryable; this.body = body;
  }
}
