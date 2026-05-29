import { NetworkService } from '../../src/network/NetworkService';
import { ConsentError } from '../../src/types';

describe('NetworkService', () => {
  let network: NetworkService;

  beforeEach(() => {
    network = new NetworkService();
    jest.resetAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should make a GET request and return response', async () => {
    const mockHeaders = new Map([['content-type', 'application/json']]);
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve('{"ok":true}'),
      headers: { forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)) },
    });

    const response = await network.request({ url: 'https://api.example.com/config' });

    expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/config', expect.objectContaining({
      method: 'GET',
      body: undefined,
    }));
    expect(response.status).toBe(200);
    expect(response.data).toBe('{"ok":true}');
    expect(response.headers['content-type']).toBe('application/json');
  });

  it('should make a POST request with body', async () => {
    const mockHeaders = new Map<string, string>();
    global.fetch = jest.fn().mockResolvedValue({
      status: 201,
      text: () => Promise.resolve(''),
      headers: { forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)) },
    });

    const body = JSON.stringify({ consent_id: 'abc' });
    await network.request({
      url: 'https://api.example.com/save',
      method: 'POST',
      body,
    });

    expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/save', expect.objectContaining({
      method: 'POST',
      body,
    }));
  });

  it('should include custom headers', async () => {
    const mockHeaders = new Map<string, string>();
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(''),
      headers: { forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)) },
    });

    await network.request({
      url: 'https://api.example.com/config',
      headers: { 'X-Custom': 'value' },
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/config',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Custom': 'value',
        }),
      }),
    );
  });

  it('should throw ConsentError with TIMEOUT code on abort', async () => {
    jest.useFakeTimers();

    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';

    global.fetch = jest.fn().mockImplementation(() => {
      return new Promise((_, reject) => {
        setTimeout(() => reject(abortError), 100);
      });
    });

    const promise = network.request({
      url: 'https://api.example.com/slow',
      timeoutMs: 50,
    });

    jest.advanceTimersByTime(100);

    await expect(promise).rejects.toThrow(ConsentError);
    await expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });

    jest.useRealTimers();
  });

  it('should throw ConsentError with NETWORK_ERROR code on fetch failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    await expect(
      network.request({ url: 'https://api.example.com/offline' })
    ).rejects.toThrow(ConsentError);

    await expect(
      network.request({ url: 'https://api.example.com/offline' })
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('should return non-2xx status without throwing', async () => {
    const mockHeaders = new Map<string, string>();
    global.fetch = jest.fn().mockResolvedValue({
      status: 500,
      text: () => Promise.resolve('Server Error'),
      headers: { forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)) },
    });

    const response = await network.request({ url: 'https://api.example.com/error' });
    expect(response.status).toBe(500);
    expect(response.data).toBe('Server Error');
  });
});
