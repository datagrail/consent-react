import { OfflineQueue } from '../../src/network/OfflineQueue';
import { StorageService } from '../../src/storage/StorageService';
import { NetworkService } from '../../src/network/NetworkService';
import { ConsentError } from '../../src/types';
import { __resetAllStores } from 'react-native-mmkv';

describe('OfflineQueue', () => {
  let storage: StorageService;
  let network: NetworkService;
  let queue: OfflineQueue;

  beforeEach(() => {
    __resetAllStores();
    storage = new StorageService('offline-queue-test');
    network = new NetworkService();
    queue = new OfflineQueue(storage, network);
  });

  describe('enqueue', () => {
    it('should add a request to the queue', () => {
      queue.enqueue({ url: 'https://api.example.com/save', method: 'POST', body: '{}' }, '/save');
      expect(queue.getPendingCount()).toBe(1);
    });

    it('should deduplicate identical requests', () => {
      const request = { url: 'https://api.example.com/save', method: 'POST' as const, body: '{"a":1}' };
      queue.enqueue(request, '/save');
      queue.enqueue(request, '/save');
      queue.enqueue(request, '/save');
      expect(queue.getPendingCount()).toBe(1);
    });

    it('should not deduplicate different requests', () => {
      queue.enqueue({ url: 'https://api.example.com/save', method: 'POST', body: '{"a":1}' }, '/save');
      queue.enqueue({ url: 'https://api.example.com/save', method: 'POST', body: '{"a":2}' }, '/save');
      queue.enqueue({ url: 'https://api.example.com/open', method: 'GET' }, '/open');
      expect(queue.getPendingCount()).toBe(3);
    });

    it('should enforce max queue size of 100', () => {
      for (let i = 0; i < 110; i++) {
        queue.enqueue(
          { url: `https://api.example.com/req-${i}`, method: 'POST', body: `${i}` },
          `/req-${i}`,
        );
      }
      expect(queue.getPendingCount()).toBe(100);
    });

    it('should drop oldest when max size exceeded', () => {
      for (let i = 0; i < 101; i++) {
        queue.enqueue(
          { url: `https://api.example.com/req-${i}`, method: 'GET' },
          `/req-${i}`,
        );
      }
      // First item (req-0) should have been dropped
      expect(queue.getPendingCount()).toBe(100);
    });
  });

  describe('drain', () => {
    it('should return zeros when queue is empty', async () => {
      const result = await queue.drain();
      expect(result).toEqual({ success: 0, failed: 0 });
    });

    it('should successfully drain requests', async () => {
      const mockHeaders = new Map<string, string>();
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        text: () => Promise.resolve(''),
        headers: { forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)) },
      });

      queue.enqueue({ url: 'https://api.example.com/save', method: 'POST', body: '{}' }, '/save');
      queue.enqueue({ url: 'https://api.example.com/open', method: 'GET' }, '/open');

      const result = await queue.drain();
      expect(result).toEqual({ success: 2, failed: 0 });
      expect(queue.getPendingCount()).toBe(0);
    });

    it('should keep items in queue on server error (5xx)', async () => {
      const mockHeaders = new Map<string, string>();
      global.fetch = jest.fn().mockResolvedValue({
        status: 503,
        text: () => Promise.resolve('Service Unavailable'),
        headers: { forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)) },
      });

      queue.enqueue({ url: 'https://api.example.com/save', method: 'POST', body: '{}' }, '/save');

      const result = await queue.drain();
      expect(result).toEqual({ success: 0, failed: 1 });
      expect(queue.getPendingCount()).toBe(1);
    });

    it('should discard items on 4xx (non-retryable)', async () => {
      const mockHeaders = new Map<string, string>();
      global.fetch = jest.fn().mockResolvedValue({
        status: 400,
        text: () => Promise.resolve('Bad Request'),
        headers: { forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)) },
      });

      queue.enqueue({ url: 'https://api.example.com/save', method: 'POST', body: '{}' }, '/save');

      const result = await queue.drain();
      expect(result).toEqual({ success: 1, failed: 0 });
      expect(queue.getPendingCount()).toBe(0);
    });

    it('should keep items in queue on network error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

      queue.enqueue({ url: 'https://api.example.com/save', method: 'POST', body: '{}' }, '/save');

      const result = await queue.drain();
      expect(result).toEqual({ success: 0, failed: 1 });
      expect(queue.getPendingCount()).toBe(1);
    });

    it('should process FIFO order', async () => {
      const callOrder: string[] = [];
      const mockHeaders = new Map<string, string>();
      global.fetch = jest.fn().mockImplementation((url: string) => {
        callOrder.push(url);
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve(''),
          headers: { forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)) },
        });
      });

      queue.enqueue({ url: 'https://api.example.com/first', method: 'GET' }, '/first');
      queue.enqueue({ url: 'https://api.example.com/second', method: 'GET' }, '/second');
      queue.enqueue({ url: 'https://api.example.com/third', method: 'GET' }, '/third');

      await queue.drain();

      expect(callOrder).toEqual([
        'https://api.example.com/first',
        'https://api.example.com/second',
        'https://api.example.com/third',
      ]);
    });
  });

  describe('getPendingCount', () => {
    it('should return 0 for empty queue', () => {
      expect(queue.getPendingCount()).toBe(0);
    });

    it('should reflect current queue size', () => {
      queue.enqueue({ url: 'https://api.example.com/a', method: 'GET' }, '/a');
      queue.enqueue({ url: 'https://api.example.com/b', method: 'GET' }, '/b');
      expect(queue.getPendingCount()).toBe(2);
    });
  });

  describe('persistence', () => {
    it('should persist queue across instances', () => {
      queue.enqueue({ url: 'https://api.example.com/save', method: 'POST', body: '{}' }, '/save');

      // Create a new OfflineQueue instance with same storage
      const queue2 = new OfflineQueue(storage, network);
      expect(queue2.getPendingCount()).toBe(1);
    });
  });
});
