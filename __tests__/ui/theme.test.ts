import { renderHook, act } from '@testing-library/react-native';
import { Appearance } from 'react-native';
import {
  extractTheme,
  useTheme,
  DEFAULT_LIGHT_THEME,
  DEFAULT_DARK_THEME,
} from '../../src/ui/theme';
import type { ConsentConfig } from '../../src/types';

// Minimal config for testing — theme doesn't read config fields yet
const mockConfig: ConsentConfig = {
  version: '1.0',
  consentContainerVersionId: 'test-id',
  dgCustomerId: 'test-customer',
  publishDate: Date.now(),
  dch: 'categorize',
  dc: null,
  privacyDomain: 'test.example.com',
  plugins: {
    scriptControl: true,
    allCookieSubdomains: true,
    cookieBlocking: true,
    localStorageBlocking: true,
    syncOTConsent: false,
  },
  testMode: false,
  ignoreDoNotTrack: false,
  trackingDetailsUrl: 'https://test.example.com/metadata.json',
  consentMode: 'optin',
  showBanner: true,
  consentPolicy: { name: 'GDPR', default: true },
  gppUsNat: false,
  initialCategories: {
    respectGpc: true,
    respectDnt: true,
    respectOptout: false,
    initial: ['dg-category-essential'],
    gpc: ['dg-category-essential'],
    optout: ['dg-category-essential'],
  },
  layout: {
    id: 'layout-1',
    name: 'Default',
    description: null,
    status: 'published',
    defaultLayout: true,
    collapsedOnMobile: false,
    firstLayerId: 'layer-1',
    gpcDntLayerId: null,
    consentLayers: {},
  },
};

describe('extractTheme', () => {
  const originalGetColorScheme = Appearance.getColorScheme;

  afterEach(() => {
    (Appearance as { getColorScheme: typeof Appearance.getColorScheme }).getColorScheme =
      originalGetColorScheme;
  });

  it('returns light theme when isDarkMode is false', () => {
    const theme = extractTheme(mockConfig, false);
    expect(theme).toBe(DEFAULT_LIGHT_THEME);
  });

  it('returns dark theme when isDarkMode is true', () => {
    const theme = extractTheme(mockConfig, true);
    expect(theme).toBe(DEFAULT_DARK_THEME);
  });

  it('uses system preference when isDarkMode is undefined and system is light', () => {
    (Appearance as { getColorScheme: typeof Appearance.getColorScheme }).getColorScheme =
      jest.fn().mockReturnValue('light');
    const theme = extractTheme(mockConfig);
    expect(theme).toBe(DEFAULT_LIGHT_THEME);
  });

  it('uses system preference when isDarkMode is undefined and system is dark', () => {
    (Appearance as { getColorScheme: typeof Appearance.getColorScheme }).getColorScheme =
      jest.fn().mockReturnValue('dark');
    const theme = extractTheme(mockConfig);
    expect(theme).toBe(DEFAULT_DARK_THEME);
  });

  it('defaults to light theme when system returns null', () => {
    (Appearance as { getColorScheme: typeof Appearance.getColorScheme }).getColorScheme =
      jest.fn().mockReturnValue(null);
    const theme = extractTheme(mockConfig);
    expect(theme).toBe(DEFAULT_LIGHT_THEME);
  });
});

describe('useTheme', () => {
  let mockListener: ((preferences: { colorScheme: string | null }) => void) | null = null;
  const mockRemove = jest.fn();

  beforeEach(() => {
    mockListener = null;
    mockRemove.mockClear();
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('light');
    jest.spyOn(Appearance, 'addChangeListener').mockImplementation((listener) => {
      mockListener = listener as (preferences: { colorScheme: string | null }) => void;
      return { remove: mockRemove };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns light theme when system is in light mode', () => {
    const { result } = renderHook(() => useTheme(mockConfig));
    expect(result.current).toBe(DEFAULT_LIGHT_THEME);
  });

  it('returns dark theme when system is in dark mode', () => {
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('dark');
    const { result } = renderHook(() => useTheme(mockConfig));
    expect(result.current).toBe(DEFAULT_DARK_THEME);
  });

  it('returns light theme when config is null and system is light', () => {
    const { result } = renderHook(() => useTheme(null));
    expect(result.current).toBe(DEFAULT_LIGHT_THEME);
  });

  it('responds to system appearance changes', () => {
    const { result } = renderHook(() => useTheme(mockConfig));
    expect(result.current).toBe(DEFAULT_LIGHT_THEME);

    act(() => {
      mockListener?.({ colorScheme: 'dark' });
    });

    expect(result.current).toBe(DEFAULT_DARK_THEME);
  });

  it('removes listener on unmount', () => {
    const { unmount } = renderHook(() => useTheme(mockConfig));
    unmount();
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });
});
