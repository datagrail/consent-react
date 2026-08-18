import type { ExpoConfig } from '@expo/config-types';
import withDataGrailConsent from '../../expo-plugin/src/index';

describe('withDataGrailConsent (Expo config plugin)', () => {
  const baseConfig: ExpoConfig = { name: 'TestApp', slug: 'test-app' };

  it('uses default tracking description when no props provided', () => {
    const result = withDataGrailConsent(baseConfig, undefined) as ExpoConfig & {
      _modResults: Record<string, string>;
    };

    expect(result._modResults.NSUserTrackingUsageDescription).toBe(
      'This app would like to access your tracking data to provide personalized ads and content.',
    );
  });

  it('uses custom tracking description from props', () => {
    const customDesc = 'We need tracking permission to improve ads.';
    const result = withDataGrailConsent(baseConfig, {
      trackingDescription: customDesc,
    }) as ExpoConfig & { _modResults: Record<string, string> };

    expect(result._modResults.NSUserTrackingUsageDescription).toBe(customDesc);
  });

  it('uses default when props object has no trackingDescription', () => {
    const result = withDataGrailConsent(baseConfig, {}) as ExpoConfig & {
      _modResults: Record<string, string>;
    };

    expect(result._modResults.NSUserTrackingUsageDescription).toBe(
      'This app would like to access your tracking data to provide personalized ads and content.',
    );
  });

  it('preserves the original config properties', () => {
    const result = withDataGrailConsent(baseConfig, undefined) as ExpoConfig & {
      _modResults: Record<string, string>;
    };

    expect(result.name).toBe('TestApp');
    expect(result.slug).toBe('test-app');
  });
});
