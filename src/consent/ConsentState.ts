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

  // TODO: Agent implements
  isCategoryEnabled(_gtmKey: string): boolean {
    throw new Error('Not implemented');
  }

  getEnabledCategories(): CategoryConsent[] {
    throw new Error('Not implemented');
  }

  serialize(): string {
    throw new Error('Not implemented');
  }

  static deserialize(_data: string): ConsentState {
    throw new Error('Not implemented');
  }
}
