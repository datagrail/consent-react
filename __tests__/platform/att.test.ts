// Import with an explicit extension: RN's haste platform resolution (default
// platform 'ios' in the jest preset) would otherwise silently resolve the
// extensionless './att' specifier to att.ios.ts, defeating this test's point
// (verifying att.ts's own fallback behavior, used when no platform-specific
// file resolves).
import { requestTrackingAuthorization, getTrackingStatus } from '../../src/platform/att.ts';

describe('ATT Bridge (fallback for non-iOS/non-Android targets)', () => {
  it('requestTrackingAuthorization resolves authorized without throwing', async () => {
    await expect(requestTrackingAuthorization()).resolves.toBe('authorized');
  });

  it('getTrackingStatus returns authorized without throwing', () => {
    expect(getTrackingStatus()).toBe('authorized');
  });
});
