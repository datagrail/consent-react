import { NativeModules } from 'react-native';
import type { ATTStatus } from '../../src/types';
import { signalSuppressesNonEssential } from '../../src/platform/attShared';

// Explicit extensions throughout: the jest preset's haste platform resolution (defaultPlatform
// 'ios') would silently resolve an extensionless './trackingSignal' to trackingSignal.ios.ts,
// defeating the point of testing each variant. Matches att.test.ts's approach.
import { readTrackingSignal as readFallback } from '../../src/platform/trackingSignal.ts';
import { readTrackingSignal as readIos } from '../../src/platform/trackingSignal.ios.ts';
import { readTrackingSignal as readAndroid } from '../../src/platform/trackingSignal.android.ts';

describe('signalSuppressesNonEssential', () => {
  it.each<[ATTStatus, boolean]>([
    ['denied', true],
    ['restricted', true],
    ['authorized', false],
    // An unread signal is not a choice. Degrading it to a suppression would fabricate an opt-out
    // the user never made.
    ['notDetermined', false],
  ])('%s suppresses: %s', (status, expected) => {
    expect(signalSuppressesNonEssential(status)).toBe(expected);
  });
});

describe('readTrackingSignal (fallback for non-iOS/non-Android targets)', () => {
  it('returns notDetermined without throwing', () => {
    // A device tracking signal is a mobile-only concept. "We could not determine anything" is the
    // honest answer here — and it does not suppress, so a missing signal never opts anyone out.
    expect(readFallback()).toBe('notDetermined');
  });
});

describe('readTrackingSignal (iOS)', () => {
  afterEach(() => {
    delete (NativeModules as Record<string, unknown>).DataGrailConsentATT;
  });

  it('returns the ATT status from the native module', () => {
    NativeModules.DataGrailConsentATT = { getTrackingStatusSync: () => 'denied' };

    expect(readIos()).toBe('denied');
  });

  it('degrades to notDetermined when the native module is unlinked', () => {
    // Unlike att.ios.ts's getTrackingStatus, this must not throw — it runs on the Universal
    // Consent path, where an unreadable signal must not take down a consent read.
    delete (NativeModules as Record<string, unknown>).DataGrailConsentATT;

    expect(readIos()).toBe('notDetermined');
  });

  it('degrades to notDetermined when the native call throws', () => {
    NativeModules.DataGrailConsentATT = {
      getTrackingStatusSync: () => {
        throw new Error('bridge failure');
      },
    };

    expect(readIos()).toBe('notDetermined');
  });
});

describe('readTrackingSignal (Android)', () => {
  afterEach(() => {
    delete (NativeModules as Record<string, unknown>).DataGrailConsentATT;
  });

  it('returns the advertising status from the native module', () => {
    NativeModules.DataGrailConsentATT = { getAdvertisingStatusSync: () => 'denied' };

    expect(readAndroid()).toBe('denied');
  });

  it('degrades to notDetermined when the native module is unlinked', () => {
    delete (NativeModules as Record<string, unknown>).DataGrailConsentATT;

    expect(readAndroid()).toBe('notDetermined');
  });

  it('degrades to notDetermined when Play Services is unavailable and the call throws', () => {
    NativeModules.DataGrailConsentATT = {
      getAdvertisingStatusSync: () => {
        throw new Error('Play Services unavailable');
      },
    };

    expect(readAndroid()).toBe('notDetermined');
  });
});
