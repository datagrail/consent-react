import { version as packageVersion } from '../package.json';
import { SDK_VERSION } from '../src/version';

describe('SDK_VERSION', () => {
  it('reads the version from package.json', () => {
    expect(SDK_VERSION).toBe(packageVersion);
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
