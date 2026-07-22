import testConfig from './test-config.json';
import { DEFAULT_CONFIG_URL } from './mockConfig';

type FetchLike = typeof fetch;

let installed = false;

function makeResponse(status: number, data: string): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(data),
    json: () => Promise.resolve(JSON.parse(data)),
    headers: {
      forEach: () => undefined,
    },
  } as unknown as Response;
}

function getUrl(input: Parameters<FetchLike>[0]): string {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

export function installE2EFetchFixtures(): void {
  if (installed) {
    return;
  }

  const originalFetch = global.fetch.bind(global);
  const testConfigJson = JSON.stringify(testConfig);

  global.fetch = ((input, init) => {
    const url = getUrl(input);

    if (url === DEFAULT_CONFIG_URL) {
      return Promise.resolve(makeResponse(200, testConfigJson));
    }

    if (
      url.startsWith('https://api.consentjs.datagrailstaging.com/save_preferences') ||
      url.startsWith('https://api.consentjs.datagrailstaging.com/save_open')
    ) {
      return Promise.resolve(makeResponse(200, '{}'));
    }

    return originalFetch(input, init);
  }) as FetchLike;

  installed = true;
}
