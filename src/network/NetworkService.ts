import type { ConsentError } from '../types';

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

/**
 * HTTP client with timeout and abort support.
 * Does NOT handle retry — that's the caller's responsibility via RetryPolicy.
 */
export class NetworkService {
  // TODO: Agent implements
  async request(_options: RequestOptions): Promise<NetworkResponse> {
    void _options;
    throw new Error('Not implemented') as unknown as ConsentError;
  }
}
