import { requestTrackingAuthorization, getTrackingStatus } from '../../src/platform/att.android';

describe('ATT Bridge (Android)', () => {
  describe('requestTrackingAuthorization', () => {
    it('resolves to authorized (no-op on Android)', async () => {
      const result = await requestTrackingAuthorization();
      expect(result).toBe('authorized');
    });
  });

  describe('getTrackingStatus', () => {
    it('returns authorized (no-op on Android)', () => {
      const result = getTrackingStatus();
      expect(result).toBe('authorized');
    });
  });
});
