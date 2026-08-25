import { reconcileSignals } from '../../src/universal/types';

const ESSENTIAL = new Set(['dg-category-essential']);

describe('reconcileSignals', () => {
  describe('when no opt-out signal applies', () => {
    it('returns the stored map untouched', () => {
      const stored = {
        'dg-category-essential': true,
        'dg-category-marketing': true,
        'dg-category-performance': false,
      };

      expect(reconcileSignals(stored, false, ESSENTIAL)).toEqual(stored);
    });

    it('never turns a category ON', () => {
      // Suppression is one-directional. Permission to track is not consent to a marketing
      // category, so an absent signal cannot enable what the user left disabled.
      const stored = { 'dg-category-marketing': false };

      expect(reconcileSignals(stored, false, ESSENTIAL)).toEqual({
        'dg-category-marketing': false,
      });
    });
  });

  describe('when an opt-out signal applies', () => {
    it('forces every non-essential category off', () => {
      const stored = {
        'dg-category-essential': true,
        'dg-category-marketing': true,
        'dg-category-performance': true,
        'dg-category-functional': true,
      };

      expect(reconcileSignals(stored, true, ESSENTIAL)).toEqual({
        'dg-category-essential': true,
        'dg-category-marketing': false,
        'dg-category-performance': false,
        'dg-category-functional': false,
      });
    });

    it('leaves essential categories at their stored value', () => {
      // Essential is exempt from suppression, but reconciliation is not a place to fabricate a
      // value either — a stored `false` stays false.
      const stored = { 'dg-category-essential': false, 'dg-category-marketing': true };

      expect(reconcileSignals(stored, true, ESSENTIAL)).toEqual({
        'dg-category-essential': false,
        'dg-category-marketing': false,
      });
    });

    it('does not add keys that were not stored', () => {
      const stored = { 'dg-category-marketing': true };

      expect(Object.keys(reconcileSignals(stored, true, ESSENTIAL))).toEqual([
        'dg-category-marketing',
      ]);
    });

    it('treats every category as suppressible when nothing is essential', () => {
      const stored = { 'dg-category-essential': true, 'dg-category-marketing': true };

      expect(reconcileSignals(stored, true, new Set())).toEqual({
        'dg-category-essential': false,
        'dg-category-marketing': false,
      });
    });

    it('handles an empty map', () => {
      expect(reconcileSignals({}, true, ESSENTIAL)).toEqual({});
    });
  });

  it('does not mutate the input map', () => {
    const stored = { 'dg-category-marketing': true };

    reconcileSignals(stored, true, ESSENTIAL);

    expect(stored).toEqual({ 'dg-category-marketing': true });
  });
});
