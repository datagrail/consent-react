import { ConsentResolver } from '../../src/consent/ConsentResolver';
import { ConfigService } from '../../src/config/ConfigService';
import type { ConsentConfig, ConsentPreferences } from '../../src/types';
import * as fs from 'fs';
import * as path from 'path';

const testConfigJson = fs.readFileSync(
  path.join(__dirname, '../fixtures/test-config.json'),
  'utf-8',
);

describe('ConsentResolver', () => {
  let config: ConsentConfig;

  beforeEach(() => {
    config = ConfigService.parseConfig(testConfigJson);
  });

  describe('resolve', () => {
    it('should return defaults and needsReconsent=true when no saved preferences', () => {
      const result = ConsentResolver.resolve(config, null, null);

      expect(result.needsReconsent).toBe(true);
      expect(result.preferences.isCustomised).toBe(false);
    });

    it('should return defaults and needsReconsent=true when version changed', () => {
      const savedPrefs: ConsentPreferences = {
        isCustomised: true,
        cookieOptions: [
          { gtmKey: 'dg-category-essential', isEnabled: true },
          { gtmKey: 'dg-category-marketing', isEnabled: false },
        ],
      };

      const result = ConsentResolver.resolve(config, savedPrefs, 'old-version');

      expect(result.needsReconsent).toBe(true);
      expect(result.preferences.isCustomised).toBe(false);
    });

    it('should return saved preferences when version matches', () => {
      const savedPrefs: ConsentPreferences = {
        isCustomised: true,
        cookieOptions: [
          { gtmKey: 'dg-category-essential', isEnabled: true },
          { gtmKey: 'dg-category-marketing', isEnabled: false },
        ],
      };

      const result = ConsentResolver.resolve(config, savedPrefs, config.version);

      expect(result.needsReconsent).toBe(false);
      expect(result.preferences).toBe(savedPrefs);
    });

    it('should handle null savedVersion as needing reconsent', () => {
      const savedPrefs: ConsentPreferences = {
        isCustomised: true,
        cookieOptions: [],
      };

      const result = ConsentResolver.resolve(config, savedPrefs, null);
      expect(result.needsReconsent).toBe(true);
    });
  });

  describe('getDefaults', () => {
    it('should enable categories from initialCategories.initial', () => {
      const defaults = ConsentResolver.getDefaults(config);

      expect(defaults.isCustomised).toBe(false);

      const essential = defaults.cookieOptions.find(
        (c) => c.gtmKey === 'dg-category-essential',
      );
      expect(essential?.isEnabled).toBe(true);

      const marketing = defaults.cookieOptions.find(
        (c) => c.gtmKey === 'dg-category-marketing',
      );
      expect(marketing?.isEnabled).toBe(true);

      const performance = defaults.cookieOptions.find(
        (c) => c.gtmKey === 'dg-category-performance',
      );
      expect(performance?.isEnabled).toBe(true);

      const functional = defaults.cookieOptions.find(
        (c) => c.gtmKey === 'dg-category-functional',
      );
      expect(functional?.isEnabled).toBe(true);
    });

    it('should disable categories NOT in initialCategories.initial', () => {
      const defaults = ConsentResolver.getDefaults(config);

      // mystery-category is in consent layers but not in initial
      const mystery = defaults.cookieOptions.find(
        (c) => c.gtmKey === 'dg-category-mystery-category',
      );
      expect(mystery?.isEnabled).toBe(false);
    });

    it('should include all categories from both initial and consent layers', () => {
      const defaults = ConsentResolver.getDefaults(config);
      const keys = defaults.cookieOptions.map((c) => c.gtmKey);

      expect(keys).toContain('dg-category-essential');
      expect(keys).toContain('dg-category-marketing');
      expect(keys).toContain('dg-category-performance');
      expect(keys).toContain('dg-category-functional');
      expect(keys).toContain('dg-category-mystery-category');
    });
  });

  describe('getEssentialCategories', () => {
    it('should return categories with alwaysOn=true', () => {
      const essential = ConsentResolver.getEssentialCategories(config);

      expect(essential).toContain('dg-category-essential');
    });

    it('should not include non-essential categories', () => {
      const essential = ConsentResolver.getEssentialCategories(config);

      expect(essential).not.toContain('dg-category-marketing');
      expect(essential).not.toContain('dg-category-performance');
      expect(essential).not.toContain('dg-category-functional');
      expect(essential).not.toContain('dg-category-mystery-category');
    });
  });

  describe('getAllCategories', () => {
    it('should return union of initialCategories.initial and consent layer categories', () => {
      const all = ConsentResolver.getAllCategories(config);

      expect(all).toContain('dg-category-essential');
      expect(all).toContain('dg-category-marketing');
      expect(all).toContain('dg-category-performance');
      expect(all).toContain('dg-category-functional');
      expect(all).toContain('dg-category-mystery-category');
    });

    it('should not have duplicates', () => {
      const all = ConsentResolver.getAllCategories(config);
      const unique = new Set(all);
      expect(all.length).toBe(unique.size);
    });
  });
});
