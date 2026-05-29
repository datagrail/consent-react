import {
  retryWithBackoff,
  getBackoffDelay,
  isRetryableStatusCode,
  isRetryableError,
  DEFAULT_RETRY_CONFIG,
} from '../../src/network/RetryPolicy';
import type { NetworkResponse } from '../../src/network/NetworkService';
import { ConsentError } from '../../src/types';

describe('RetryPolicy', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getBackoffDelay', () => {
    it('should return base delay for attempt 1', () => {
      expect(getBackoffDelay(1, 250)).toBe(250);
    });

    it('should double for each subsequent attempt', () => {
      expect(getBackoffDelay(2, 250)).toBe(500);
      expect(getBackoffDelay(3, 250)).toBe(1000);
      expect(getBackoffDelay(4, 250)).toBe(2000);
      expect(getBackoffDelay(5, 250)).toBe(4000);
    });
  });

  describe('isRetryableStatusCode', () => {
    it('should return true for 5xx', () => {
      expect(isRetryableStatusCode(500)).toBe(true);
      expect(isRetryableStatusCode(502)).toBe(true);
      expect(isRetryableStatusCode(503)).toBe(true);
    });

    it('should return false for 4xx', () => {
      expect(isRetryableStatusCode(400)).toBe(false);
      expect(isRetryableStatusCode(401)).toBe(false);
      expect(isRetryableStatusCode(404)).toBe(false);
    });

    it('should return false for 2xx', () => {
      expect(isRetryableStatusCode(200)).toBe(false);
      expect(isRetryableStatusCode(201)).toBe(false);
    });
  });

  describe('isRetryableError', () => {
    it('should return true for TypeError (network failure)', () => {
      expect(isRetryableError(new TypeError('Failed to fetch'))).toBe(true);
    });

    it('should return true for ConsentError NETWORK_ERROR', () => {
      expect(isRetryableError(new ConsentError('NETWORK_ERROR', 'fail'))).toBe(true);
    });

    it('should return true for ConsentError TIMEOUT', () => {
      expect(isRetryableError(new ConsentError('TIMEOUT', 'timeout'))).toBe(true);
    });

    it('should return false for ConsentError PARSE_ERROR', () => {
      expect(isRetryableError(new ConsentError('PARSE_ERROR', 'bad json'))).toBe(false);
    });

    it('should return false for generic errors', () => {
      expect(isRetryableError(new Error('unknown'))).toBe(false);
    });
  });

  describe('retryWithBackoff', () => {
    const makeResponse = (status: number): NetworkResponse => ({
      status,
      data: '',
      headers: {},
    });

    it('should return immediately on 200', async () => {
      const operation = jest.fn().mockResolvedValue(makeResponse(200));

      const result = await retryWithBackoff(operation);

      expect(result.status).toBe(200);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should return immediately on 4xx (never retry)', async () => {
      const operation = jest.fn().mockResolvedValue(makeResponse(404));

      const result = await retryWithBackoff(operation);

      expect(result.status).toBe(404);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on 5xx up to maxAttempts', async () => {
      const operation = jest.fn().mockResolvedValue(makeResponse(500));
      const config = { maxAttempts: 3, baseDelayMs: 100, timeoutMs: 30000 };

      const promise = retryWithBackoff(operation, config);

      // Advance through retries
      await jest.advanceTimersByTimeAsync(100); // attempt 1 delay
      await jest.advanceTimersByTimeAsync(200); // attempt 2 delay

      const result = await promise;

      expect(result.status).toBe(500);
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should return success if retry succeeds', async () => {
      const operation = jest
        .fn()
        .mockResolvedValueOnce(makeResponse(503))
        .mockResolvedValueOnce(makeResponse(200));

      const config = { maxAttempts: 3, baseDelayMs: 100, timeoutMs: 30000 };
      const promise = retryWithBackoff(operation, config);

      await jest.advanceTimersByTimeAsync(100); // first retry delay

      const result = await promise;
      expect(result.status).toBe(200);
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should retry on network error (TypeError)', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(makeResponse(200));

      const config = { maxAttempts: 3, baseDelayMs: 100, timeoutMs: 30000 };
      const promise = retryWithBackoff(operation, config);

      await jest.advanceTimersByTimeAsync(100);

      const result = await promise;
      expect(result.status).toBe(200);
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should retry on ConsentError NETWORK_ERROR', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new ConsentError('NETWORK_ERROR', 'offline'))
        .mockResolvedValueOnce(makeResponse(200));

      const config = { maxAttempts: 3, baseDelayMs: 100, timeoutMs: 30000 };
      const promise = retryWithBackoff(operation, config);

      await jest.advanceTimersByTimeAsync(100);

      const result = await promise;
      expect(result.status).toBe(200);
    });

    it('should NOT retry on non-retryable errors', async () => {
      const operation = jest.fn().mockRejectedValue(new ConsentError('PARSE_ERROR', 'bad json'));

      const config = { maxAttempts: 3, baseDelayMs: 100, timeoutMs: 30000 };

      await expect(retryWithBackoff(operation, config)).rejects.toThrow(ConsentError);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should throw after exhausting retries on network error', async () => {
      jest.useRealTimers();

      const operation = jest.fn().mockImplementation(() =>
        Promise.reject(new ConsentError('NETWORK_ERROR', 'offline'))
      );

      const config = { maxAttempts: 3, baseDelayMs: 1, timeoutMs: 30000 };

      await expect(retryWithBackoff(operation, config)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
      expect(operation).toHaveBeenCalledTimes(3);

      jest.useFakeTimers();
    });

    it('should use default config when none provided', async () => {
      const operation = jest.fn().mockResolvedValue(makeResponse(200));

      await retryWithBackoff(operation);

      expect(operation).toHaveBeenCalledTimes(1);
      // Just verifying it doesn't throw with no config
      expect(DEFAULT_RETRY_CONFIG.maxAttempts).toBe(5);
    });
  });
});
