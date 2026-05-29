/**
 * Retry policy matching native SDKs: 5 attempts, 250ms base, exponential backoff.
 * Only retries on 5xx or network errors. Never retries 4xx.
 */
export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  timeoutMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 5,
  baseDelayMs: 250,
  timeoutMs: 30_000,
};

export function getBackoffDelay(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * Math.pow(2, attempt - 1);
}

export function isRetryableStatusCode(status: number): boolean {
  return status >= 500;
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof TypeError) return true; // network failure
  return false;
}
