import type { StorageService } from '../storage/StorageService';
import type { NetworkService, RequestOptions } from './NetworkService';

export interface QueuedRequest {
  id: string;
  options: RequestOptions;
  queuedAt: string;
  endpoint: string;
}

const MAX_QUEUE_SIZE = 100;

/**
 * Persists failed network requests to MMKV. Drains FIFO on connectivity restore.
 * Deduplicates by request key (method + url + body hash).
 */
export class OfflineQueue {
  constructor(
    private readonly storage: StorageService,
    private readonly network: NetworkService,
  ) {}

  enqueue(request: RequestOptions, endpoint: string): void {
    const queue = this.loadQueue();
    const id = this.getRequestKey(request);

    // Deduplication: skip if already queued
    if (queue.some((item) => item.id === id)) {
      return;
    }

    // Enforce max size — drop oldest if full
    if (queue.length >= MAX_QUEUE_SIZE) {
      queue.shift();
    }

    queue.push({
      id,
      options: request,
      queuedAt: new Date().toISOString(),
      endpoint,
    });

    this.saveQueue(queue);
  }

  async drain(): Promise<{ success: number; failed: number }> {
    const queue = this.loadQueue();
    if (queue.length === 0) {
      return { success: 0, failed: 0 };
    }

    let success = 0;
    let failed = 0;
    const remaining: QueuedRequest[] = [];

    for (const item of queue) {
      try {
        const response = await this.network.request(item.options);
        if (response.status >= 200 && response.status < 300) {
          success++;
        } else if (response.status >= 500) {
          // Server error — keep in queue for next drain
          remaining.push(item);
          failed++;
        } else {
          // 4xx — discard (will never succeed on retry)
          success++; // count as "processed" (removed from queue)
        }
      } catch {
        // Network error — keep in queue
        remaining.push(item);
        failed++;
      }
    }

    this.saveQueue(remaining);
    return { success, failed };
  }

  getPendingCount(): number {
    return this.loadQueue().length;
  }

  private getRequestKey(request: RequestOptions): string {
    const method = request.method ?? 'GET';
    const bodyHash = request.body ? simpleHash(request.body) : '';
    return `${method}:${request.url}:${bodyHash}`;
  }

  private loadQueue(): QueuedRequest[] {
    const events = this.storage.loadPendingEvents();
    return events as QueuedRequest[];
  }

  private saveQueue(queue: QueuedRequest[]): void {
    this.storage.savePendingEvents(queue);
  }
}

/**
 * Simple string hash for deduplication. Not cryptographic.
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}
