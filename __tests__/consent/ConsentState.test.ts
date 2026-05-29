import { ConsentState } from '../../src/consent/ConsentState';
import type { ConsentPreferences } from '../../src/types';

describe('ConsentState', () => {
  const preferences: ConsentPreferences = {
    isCustomised: true,
    cookieOptions: [
      { gtmKey: 'dg-category-essential', isEnabled: true },
      { gtmKey: 'dg-category-marketing', isEnabled: false },
      { gtmKey: 'dg-category-performance', isEnabled: true },
      { gtmKey: 'dg-category-functional', isEnabled: false },
    ],
  };

  const configVersion = 'v1.0.0';

  describe('constructor', () => {
    it('should store preferences and config version', () => {
      const state = new ConsentState(preferences, configVersion);
      expect(state.preferences).toBe(preferences);
      expect(state.configVersion).toBe(configVersion);
    });
  });

  describe('isCategoryEnabled', () => {
    it('should return true for enabled category', () => {
      const state = new ConsentState(preferences, configVersion);
      expect(state.isCategoryEnabled('dg-category-essential')).toBe(true);
      expect(state.isCategoryEnabled('dg-category-performance')).toBe(true);
    });

    it('should return false for disabled category', () => {
      const state = new ConsentState(preferences, configVersion);
      expect(state.isCategoryEnabled('dg-category-marketing')).toBe(false);
      expect(state.isCategoryEnabled('dg-category-functional')).toBe(false);
    });

    it('should return false for unknown category', () => {
      const state = new ConsentState(preferences, configVersion);
      expect(state.isCategoryEnabled('dg-category-unknown')).toBe(false);
    });
  });

  describe('getEnabledCategories', () => {
    it('should return only enabled categories', () => {
      const state = new ConsentState(preferences, configVersion);
      const enabled = state.getEnabledCategories();

      expect(enabled).toEqual([
        { gtmKey: 'dg-category-essential', isEnabled: true },
        { gtmKey: 'dg-category-performance', isEnabled: true },
      ]);
    });

    it('should return empty array when nothing enabled', () => {
      const emptyPrefs: ConsentPreferences = {
        isCustomised: false,
        cookieOptions: [
          { gtmKey: 'dg-category-marketing', isEnabled: false },
        ],
      };
      const state = new ConsentState(emptyPrefs, configVersion);
      expect(state.getEnabledCategories()).toEqual([]);
    });
  });

  describe('serialize / deserialize', () => {
    it('should round-trip through serialization', () => {
      const state = new ConsentState(preferences, configVersion);
      const serialized = state.serialize();
      const deserialized = ConsentState.deserialize(serialized);

      expect(deserialized.preferences).toEqual(preferences);
      expect(deserialized.configVersion).toBe(configVersion);
    });

    it('should serialize to valid JSON', () => {
      const state = new ConsentState(preferences, configVersion);
      const serialized = state.serialize();
      const parsed = JSON.parse(serialized);

      expect(parsed).toHaveProperty('preferences');
      expect(parsed).toHaveProperty('configVersion');
    });

    it('should throw on invalid JSON in deserialize', () => {
      expect(() => ConsentState.deserialize('not-json')).toThrow();
    });
  });
});
