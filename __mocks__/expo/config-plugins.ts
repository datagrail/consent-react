/**
 * Manual mock for expo/config-plugins.
 * Provides a minimal implementation of withInfoPlist for testing.
 */

export type ExpoConfig = {
  name: string;
  slug: string;
  [key: string]: unknown;
};

export type ConfigPlugin<T = void> = (config: ExpoConfig, props: T) => ExpoConfig;

type InfoPlistModConfig = {
  modResults: Record<string, string>;
};

export function withInfoPlist(
  config: ExpoConfig,
  callback: (modConfig: InfoPlistModConfig) => InfoPlistModConfig,
): ExpoConfig {
  const modConfig: InfoPlistModConfig = { modResults: {} };
  const result = callback(modConfig);
  return { ...config, _modResults: result.modResults } as ExpoConfig;
}
