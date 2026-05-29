import type { ConsentConfig, ConsentPreferences, CategoryConsent } from '../types';

/**
 * Resolves effective consent state by merging config defaults with saved user preferences.
 * Handles version bumps triggering re-consent.
 */
export class ConsentResolver {
  /**
   * Get effective preferences: saved if they exist and version matches,
   * otherwise defaults from config.initialCategories.
   */
  static resolve(
    config: ConsentConfig,
    savedPreferences: ConsentPreferences | null,
    savedVersion: string | null,
  ): { preferences: ConsentPreferences; needsReconsent: boolean } {
    // If no saved preferences, use defaults and flag reconsent
    if (savedPreferences === null) {
      return {
        preferences: ConsentResolver.getDefaults(config),
        needsReconsent: true,
      };
    }

    // If version changed, flag reconsent but still use defaults
    if (savedVersion !== config.version) {
      return {
        preferences: ConsentResolver.getDefaults(config),
        needsReconsent: true,
      };
    }

    // Version matches — use saved preferences
    return {
      preferences: savedPreferences,
      needsReconsent: false,
    };
  }

  /**
   * Build default preferences from config — all categories in initialCategories.initial are enabled.
   */
  static getDefaults(config: ConsentConfig): ConsentPreferences {
    const allCategories = ConsentResolver.getAllCategories(config);
    const initialEnabled = new Set(config.initialCategories.initial);

    const cookieOptions: CategoryConsent[] = allCategories.map((gtmKey) => ({
      gtmKey,
      isEnabled: initialEnabled.has(gtmKey),
    }));

    return {
      isCustomised: false,
      cookieOptions,
    };
  }

  /**
   * Get GTM keys for always-on/essential categories.
   */
  static getEssentialCategories(config: ConsentConfig): string[] {
    const essentialKeys: Set<string> = new Set();

    for (const layer of Object.values(config.layout.consentLayers)) {
      for (const element of layer.elements) {
        if (element.consentLayerCategories) {
          for (const cat of element.consentLayerCategories) {
            if (cat.alwaysOn) {
              essentialKeys.add(cat.gtmKey);
            }
          }
        }
      }
    }

    return Array.from(essentialKeys);
  }

  /**
   * Get all category GTM keys from config (initialCategories + consent layers).
   */
  static getAllCategories(config: ConsentConfig): string[] {
    const allKeys: Set<string> = new Set();

    // Add all from initialCategories.initial
    for (const key of config.initialCategories.initial) {
      allKeys.add(key);
    }

    // Add all gtmKeys from consent layer elements
    for (const layer of Object.values(config.layout.consentLayers)) {
      for (const element of layer.elements) {
        if (element.consentLayerCategories) {
          for (const cat of element.consentLayerCategories) {
            allKeys.add(cat.gtmKey);
          }
        }
      }
    }

    return Array.from(allKeys);
  }
}
