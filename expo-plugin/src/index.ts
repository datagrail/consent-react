import { withATTDescription } from './withATTDescription';
import type { ConfigPlugin } from '@expo/config-plugins';

/**
 * Expo config plugin for @datagrail.io/react-native-consent.
 * Automatically configures NSUserTrackingUsageDescription in iOS Info.plist.
 *
 * Usage in app.json / app.config.js:
 * ```json
 * {
 *   "plugins": [
 *     ["@datagrail.io/react-native-consent/expo-plugin", {
 *       "trackingDescription": "We use tracking to personalize your experience."
 *     }]
 *   ]
 * }
 * ```
 */
const withDataGrailConsent: ConfigPlugin<{ trackingDescription?: string } | void> = (
  config,
  props,
) => {
  const description =
    props?.trackingDescription ??
    'This app would like to access your tracking data to provide personalized ads and content.';
  return withATTDescription(config, description);
};

export default withDataGrailConsent;
