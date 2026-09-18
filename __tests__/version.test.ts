import { version as packageVersion } from '../package.json';
import { CONFIG_SCHEMA_VERSION, SDK_VERSION } from '../src/version';

describe('SDK_VERSION', () => {
  it('reads the version from package.json', () => {
    expect(SDK_VERSION).toBe(packageVersion);
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('CONFIG_SCHEMA_VERSION', () => {
  it('is the build-time consent-config wire schema version', () => {
    expect(CONFIG_SCHEMA_VERSION).toBe('v1');
  });
});
