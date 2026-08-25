import type { ExpoConfig } from '@expo/config-types';
import { withATTDescription } from '../../expo-plugin/src/withATTDescription';

describe('withATTDescription', () => {
  it('sets NSUserTrackingUsageDescription in Info.plist', () => {
    const config = { name: 'TestApp', slug: 'test-app' } as ExpoConfig;
    const description = 'We use tracking to show relevant content.';

    const result = withATTDescription(config, description) as ExpoConfig & {
      _modResults: Record<string, string>;
    };

    expect(result._modResults.NSUserTrackingUsageDescription).toBe(description);
  });

  it('uses the provided description string exactly', () => {
    const config = { name: 'TestApp', slug: 'test-app' } as ExpoConfig;
    const customDescription = 'Custom ATT description for this app.';

    const result = withATTDescription(config, customDescription) as ExpoConfig & {
      _modResults: Record<string, string>;
    };

    expect(result._modResults.NSUserTrackingUsageDescription).toBe(customDescription);
  });

  it('preserves original config properties', () => {
    const config = { name: 'MyApp', slug: 'my-app' } as ExpoConfig;

    const result = withATTDescription(config, 'description');

    expect(result.name).toBe('MyApp');
    expect(result.slug).toBe('my-app');
  });
});
