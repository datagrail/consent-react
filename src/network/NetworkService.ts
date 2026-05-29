import { ConsentError } from '../types';

export type HttpMethod = 'GET' | 'POST';

export interface RequestOptions {
  url: string;
  method?: HttpMethod;
  body?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface NetworkResponse {
  status: number;
  data: string;
  headers: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * HTTP client with timeout and abort support.
 * Does NOT handle retry — that's the caller's responsibility via RetryPolicy.
 */
export class NetworkService {
  async request(options: RequestOptions): Promise<NetworkResponse> {
    const { url, method = 'GET', body, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: method === 'POST' ? body : undefined,
        signal: controller.signal,
      });

      const data = await response.text();

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return {
        status: response.status,
        data,
        headers: responseHeaders,
      };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ConsentError('TIMEOUT', `Request to ${url} timed out after ${timeoutMs}ms`);
      }
      const message = error instanceof Error ? error.message : 'Network request failed';
      throw new ConsentError('NETWORK_ERROR', message);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
