import { withInfoPlist } from 'expo/config-plugins';
import type { ExpoConfig } from 'expo/config-plugins';

/**
 * Expo config plugin mod that adds NSUserTrackingUsageDescription to Info.plist.
 * This is required for ATT (App Tracking Transparency) on iOS 14+.
 */
export function withATTDescription(
  config: ExpoConfig,
  description: string,
): ExpoConfig {
  return withInfoPlist(config, (modConfig) => {
    modConfig.modResults.NSUserTrackingUsageDescription = description;
    return modConfig;
  });
}
