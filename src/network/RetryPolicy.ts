import { ConsentError } from '../types';
import type { NetworkResponse } from './NetworkService';

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
  if (error instanceof ConsentError && error.code === 'NETWORK_ERROR') return true;
  if (error instanceof ConsentError && error.code === 'TIMEOUT') return true;
  return false;
}

/**
 * Execute an async operation with exponential backoff retry.
 * Retries on 5xx responses or network errors. Never retries 4xx.
 */
export async function retryWithBackoff<T extends NetworkResponse>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): Promise<T> {
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      const response = await operation();

      // If response status is retryable (5xx), retry
      if (isRetryableStatusCode(response.status) && attempt < config.maxAttempts) {
        await delay(getBackoffDelay(attempt, config.baseDelayMs));
        continue;
      }

      // 4xx or 2xx — return immediately (never retry 4xx)
      return response;
    } catch (error: unknown) {
      // Only retry on retryable errors
      if (!isRetryableError(error) || attempt === config.maxAttempts) {
        throw error;
      }

      await delay(getBackoffDelay(attempt, config.baseDelayMs));
    }
  }

  // Unreachable: every iteration either returns, throws, or continues (and
  // continue only happens when attempt < maxAttempts, so the loop always
  // returns/throws by the final attempt). Kept only to satisfy TypeScript's
  // control-flow analysis, which can't prove the loop always exits above.
  throw new Error('unreachable: retryWithBackoff exhausted attempts without returning or throwing');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
