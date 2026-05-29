import type { ConsentPreferences, CategoryConsent } from '../types';

/**
 * Immutable consent state model. Tracks category preferences + config version.
 */
export class ConsentState {
  readonly preferences: ConsentPreferences;
  readonly configVersion: string;

  constructor(preferences: ConsentPreferences, configVersion: string) {
    this.preferences = preferences;
    this.configVersion = configVersion;
  }

  isCategoryEnabled(gtmKey: string): boolean {
    const category = this.preferences.cookieOptions.find((opt) => opt.gtmKey === gtmKey);
    return category?.isEnabled ?? false;
  }

  getEnabledCategories(): CategoryConsent[] {
    return this.preferences.cookieOptions.filter((opt) => opt.isEnabled);
  }

  serialize(): string {
    return JSON.stringify({
      preferences: this.preferences,
      configVersion: this.configVersion,
    });
  }

  static deserialize(data: string): ConsentState {
    const parsed = JSON.parse(data) as {
      preferences: ConsentPreferences;
      configVersion: string;
    };
    return new ConsentState(parsed.preferences, parsed.configVersion);
  }
}
