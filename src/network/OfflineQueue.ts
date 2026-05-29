import type { StorageService } from '../storage/StorageService';
import type { NetworkService, RequestOptions } from './NetworkService';

export interface QueuedRequest {
  id: string;
  options: RequestOptions;
  queuedAt: string;
  endpoint: string;
}

/**
 * Persists failed network requests to MMKV. Drains FIFO on connectivity restore.
 * Deduplicates by request key (method + url + body hash).
 */
export class OfflineQueue {
  constructor(
    private readonly storage: StorageService,
    private readonly network: NetworkService,
  ) {}

  // TODO: Agent implements
  enqueue(_request: RequestOptions, _endpoint: string): void {
    throw new Error('Not implemented');
  }

  async drain(): Promise<{ success: number; failed: number }> {
    void this.storage;
    void this.network;
    throw new Error('Not implemented');
  }

  getPendingCount(): number {
    throw new Error('Not implemented');
  }
}
