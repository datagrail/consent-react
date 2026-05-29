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
const mockGetTrackingStatusSync = jest.fn<ATTStatus, []>();

NativeModules.DataGrailConsentATT = {
  requestTrackingAuthorization: mockRequestTrackingAuthorization,
  getTrackingStatusSync: mockGetTrackingStatusSync,
};

// Import after mocks are set up
import { requestTrackingAuthorization, getTrackingStatus } from '../../src/platform/att.ios';

describe('ATT Bridge (iOS)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPreferences.mockReturnValue(null);
    mockSavePreferences.mockResolvedValue(undefined);
  });

  describe('requestTrackingAuthorization', () => {
    it('returns the ATT status from native module', async () => {
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
    it('returns the status from native module synchronously', () => {
      mockGetTrackingStatusSync.mockReturnValue('authorized');

      const result = getTrackingStatus();

      expect(result).toBe('authorized');
      expect(mockGetTrackingStatusSync).toHaveBeenCalledTimes(1);
    });

    it('returns notDetermined when not yet prompted', () => {
      mockGetTrackingStatusSync.mockReturnValue('notDetermined');

      const result = getTrackingStatus();

      expect(result).toBe('notDetermined');
    });

    it('returns denied when user rejected', () => {
      mockGetTrackingStatusSync.mockReturnValue('denied');

      const result = getTrackingStatus();

      expect(result).toBe('denied');
    });

    it('returns restricted when restricted', () => {
      mockGetTrackingStatusSync.mockReturnValue('restricted');

      const result = getTrackingStatus();

      expect(result).toBe('restricted');
    });
  });

  describe('native module not found', () => {
    it('throws when native module is not linked', () => {
      const originalModule = NativeModules.DataGrailConsentATT;
      delete NativeModules.DataGrailConsentATT;

      expect(() => getTrackingStatus()).toThrow(
        'DataGrailConsentATT native module not found',
      );

      NativeModules.DataGrailConsentATT = originalModule;
    });
  });
});
