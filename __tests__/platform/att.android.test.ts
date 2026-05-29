import { NativeModules } from 'react-native';
import type { ATTStatus, ConsentPreferences } from '../../src/types';

// Mock ConsentManager
const mockGetPreferences = jest.fn<ConsentPreferences | null, []>();
const mockSavePreferences = jest.fn<Promise<void>, [ConsentPreferences]>();

jest.mock('../../src/ConsentManager', () => ({
  getPreferences: () => mockGetPreferences(),
  savePreferences: (prefs: ConsentPreferences) => mockSavePreferences(prefs),
}));

// Mock native module
const mockRequestTrackingAuthorization = jest.fn<Promise<ATTStatus>, []>();
const mockGetAdvertisingStatusSync = jest.fn<ATTStatus, []>();

NativeModules.DataGrailConsentATT = {
  requestTrackingAuthorization: mockRequestTrackingAuthorization,
  getAdvertisingStatusSync: mockGetAdvertisingStatusSync,
};

// Import after mocks are set up
import { requestTrackingAuthorization, getTrackingStatus } from '../../src/platform/att.android';

describe('ATT Bridge (Android)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPreferences.mockReturnValue(null);
    mockSavePreferences.mockResolvedValue(undefined);
  });

  describe('requestTrackingAuthorization', () => {
    it('returns the advertising status from native module', async () => {
      mockRequestTrackingAuthorization.mockResolvedValue('authorized');

      const result = await requestTrackingAuthorization();

      expect(result).toBe('authorized');
      expect(mockRequestTrackingAuthorization).toHaveBeenCalledTimes(1);
    });

    it('enables marketing category when authorized', async () => {
      mockRequestTrackingAuthorization.mockResolvedValue('authorized');
      mockGetPreferences.mockReturnValue(null);

      await requestTrackingAuthorization();

      expect(mockSavePreferences).toHaveBeenCalledWith({
        isCustomised: true,
        cookieOptions: [{ gtmKey: 'dg-category-marketing', isEnabled: true }],
      });
    });

    it('disables marketing category when denied', async () => {
      mockRequestTrackingAuthorization.mockResolvedValue('denied');
      mockGetPreferences.mockReturnValue(null);

      await requestTrackingAuthorization();

      expect(mockSavePreferences).toHaveBeenCalledWith({
        isCustomised: true,
        cookieOptions: [{ gtmKey: 'dg-category-marketing', isEnabled: false }],
      });
    });

    it('does not modify consent when status is notDetermined', async () => {
      mockRequestTrackingAuthorization.mockResolvedValue('notDetermined');

      await requestTrackingAuthorization();

      expect(mockSavePreferences).not.toHaveBeenCalled();
    });

    it('does not modify consent when status is restricted', async () => {
      mockRequestTrackingAuthorization.mockResolvedValue('restricted');

      await requestTrackingAuthorization();

      expect(mockSavePreferences).not.toHaveBeenCalled();
    });

    it('preserves existing cookie options when updating marketing', async () => {
      mockRequestTrackingAuthorization.mockResolvedValue('authorized');
      mockGetPreferences.mockReturnValue({
        isCustomised: true,
        cookieOptions: [
          { gtmKey: 'dg-category-essential', isEnabled: true },
          { gtmKey: 'dg-category-marketing', isEnabled: false },
          { gtmKey: 'dg-category-performance', isEnabled: true },
        ],
      });

      await requestTrackingAuthorization();

      expect(mockSavePreferences).toHaveBeenCalledWith({
        isCustomised: true,
        cookieOptions: [
          { gtmKey: 'dg-category-essential', isEnabled: true },
          { gtmKey: 'dg-category-marketing', isEnabled: true },
          { gtmKey: 'dg-category-performance', isEnabled: true },
        ],
      });
    });

    it('appends marketing category if not present in existing preferences', async () => {
      mockRequestTrackingAuthorization.mockResolvedValue('denied');
      mockGetPreferences.mockReturnValue({
        isCustomised: true,
        cookieOptions: [
          { gtmKey: 'dg-category-essential', isEnabled: true },
          { gtmKey: 'dg-category-performance', isEnabled: true },
        ],
      });

      await requestTrackingAuthorization();

      expect(mockSavePreferences).toHaveBeenCalledWith({
        isCustomised: true,
        cookieOptions: [
          { gtmKey: 'dg-category-essential', isEnabled: true },
          { gtmKey: 'dg-category-performance', isEnabled: true },
          { gtmKey: 'dg-category-marketing', isEnabled: false },
        ],
      });
    });
  });

  describe('getTrackingStatus', () => {
    it('returns the cached status from native module synchronously', () => {
      mockGetAdvertisingStatusSync.mockReturnValue('authorized');

      const result = getTrackingStatus();

      expect(result).toBe('authorized');
      expect(mockGetAdvertisingStatusSync).toHaveBeenCalledTimes(1);
    });

    it('returns notDetermined when never checked', () => {
      mockGetAdvertisingStatusSync.mockReturnValue('notDetermined');

      const result = getTrackingStatus();

      expect(result).toBe('notDetermined');
    });

    it('returns denied when user opted out', () => {
      mockGetAdvertisingStatusSync.mockReturnValue('denied');

      const result = getTrackingStatus();

      expect(result).toBe('denied');
    });
  });

  describe('graceful degradation when native module is null', () => {
    let originalModule: typeof NativeModules.DataGrailConsentATT;

    beforeEach(() => {
      originalModule = NativeModules.DataGrailConsentATT;
    });

    afterEach(() => {
      NativeModules.DataGrailConsentATT = originalModule;
    });

    it('requestTrackingAuthorization returns authorized when module unavailable', async () => {
      // Need to re-import to pick up the null module
      delete NativeModules.DataGrailConsentATT;

      // Use isolateModules to get a fresh import with null native module
      let freshRequestTrackingAuthorization: typeof requestTrackingAuthorization;
      jest.isolateModules(() => {
        // Re-mock ConsentManager in the isolated module scope
        jest.mock('../../src/ConsentManager', () => ({
          getPreferences: () => mockGetPreferences(),
          savePreferences: (prefs: ConsentPreferences) => mockSavePreferences(prefs),
        }));
        const fresh = require('../../src/platform/att.android');
        freshRequestTrackingAuthorization = fresh.requestTrackingAuthorization;
      });

      const result = await freshRequestTrackingAuthorization!();
      expect(result).toBe('authorized');
    });

    it('getTrackingStatus returns authorized when module unavailable', () => {
      delete NativeModules.DataGrailConsentATT;

      let freshGetTrackingStatus: typeof getTrackingStatus;
      jest.isolateModules(() => {
        jest.mock('../../src/ConsentManager', () => ({
          getPreferences: () => mockGetPreferences(),
          savePreferences: (prefs: ConsentPreferences) => mockSavePreferences(prefs),
        }));
        const fresh = require('../../src/platform/att.android');
        freshGetTrackingStatus = fresh.getTrackingStatus;
      });

      const result = freshGetTrackingStatus!();
      expect(result).toBe('authorized');
    });
  });
});
