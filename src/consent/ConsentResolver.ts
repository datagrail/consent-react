import type { ConsentConfig, ConsentPreferences } from '../types';

/**
 * Resolves effective consent state by merging config defaults with saved user preferences.
 * Handles version bumps triggering re-consent.
 */
export class ConsentResolver {
  // TODO: Agent implements

  /**
   * Get effective preferences: saved if they exist and version matches,
   * otherwise defaults from config.initialCategories.
   */
  static resolve(
    _config: ConsentConfig,
    _savedPreferences: ConsentPreferences | null,
    _savedVersion: string | null,
  ): { preferences: ConsentPreferences; needsReconsent: boolean } {
    throw new Error('Not implemented');
  }

  /**
   * Build default preferences from config — all categories in initialCategories.initial are enabled.
   */
  static getDefaults(_config: ConsentConfig): ConsentPreferences {
    throw new Error('Not implemented');
  }

  /**
   * Get GTM keys for always-on/essential categories.
   */
  static getEssentialCategories(_config: ConsentConfig): string[] {
    throw new Error('Not implemented');
  }

  /**
   * Get all category GTM keys from config (initialCategories + consent layers).
   */
  static getAllCategories(_config: ConsentConfig): string[] {
    throw new Error('Not implemented');
  }
}
