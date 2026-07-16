import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { Banner } from '../../src/ui/Banner';
import type { ConsentConfig, ConsentPreferences } from '../../src/types';

jest.mock('../../src/ConsentManager', () => ({
  getConfig: jest.fn(),
  getCategories: jest.fn(),
  getPreferences: jest.fn(),
  savePreferences: jest.fn().mockResolvedValue(undefined),
  acceptAll: jest.fn().mockResolvedValue(undefined),
  rejectAll: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ConsentManager = require('../../src/ConsentManager') as {
  getConfig: jest.Mock;
  getCategories: jest.Mock;
  getPreferences: jest.Mock;
  savePreferences: jest.Mock;
  acceptAll: jest.Mock;
  rejectAll: jest.Mock;
};

const testConfig: ConsentConfig = {
  version: '1.0',
  consentContainerVersionId: 'test-version-id',
  dgCustomerId: 'test-customer-id',
  publishDate: 1765415800250,
  dch: 'categorize',
  dc: 'dg-category-marketing',
  privacyDomain: 'api.consentjs.datagrailstaging.com',
  plugins: {
    scriptControl: true,
    allCookieSubdomains: true,
    cookieBlocking: true,
    localStorageBlocking: true,
    syncOTConsent: false,
  },
  testMode: false,
  ignoreDoNotTrack: false,
  trackingDetailsUrl: 'https://api.consentjs.datagrailstaging.com/test/service-metadata.json',
  consentMode: 'optout',
  showBanner: true,
  consentPolicy: { name: 'CPRA', default: false },
  gppUsNat: true,
  initialCategories: {
    respectGpc: true,
    respectDnt: true,
    respectOptout: false,
    initial: ['dg-category-essential', 'dg-category-marketing'],
    gpc: ['dg-category-essential'],
    optout: ['dg-category-essential'],
  },
  layout: {
    id: 'layout-1',
    name: 'Test Layout',
    description: null,
    status: 'published',
    defaultLayout: true,
    collapsedOnMobile: false,
    firstLayerId: 'layer-first',
    gpcDntLayerId: null,
    consentLayers: {
      'layer-first': {
        id: 'layer-first',
        name: 'First Layer',
        position: 'bottom',
        showCloseButton: true,
        bannerApiId: 'first-layer',
        elements: [
          {
            id: 'el-title',
            order: 1,
            type: 'ConsentLayerTextElement',
            style: 'dg-title',
            translations: {
              en: { id: 't1', locale: 'en', value: 'Privacy Settings' },
            },
          },
          {
            id: 'el-body',
            order: 2,
            type: 'ConsentLayerTextElement',
            style: 'dg-main-content-explanation',
            translations: {
              en: { id: 't2', locale: 'en', value: 'We use cookies to improve your experience.' },
            },
          },
          {
            id: 'el-link',
            order: 3,
            type: 'ConsentLayerLinkElement',
            links: [
              {
                id: 'link-1',
                order: 1,
                translations: {
                  en: { id: 'lt1', locale: 'en', text: 'Privacy Policy', url: 'https://example.com/privacy' },
                },
              },
            ],
            translations: {},
          },
          {
            id: 'el-accept',
            order: 4,
            type: 'ConsentLayerButtonElement',
            buttonAction: 'accept_all',
            translations: {
              en: { id: 'bt1', locale: 'en', value: 'Accept All' },
            },
          },
          {
            id: 'el-reject',
            order: 5,
            type: 'ConsentLayerButtonElement',
            buttonAction: 'reject_all',
            translations: {
              en: { id: 'bt2', locale: 'en', value: 'Reject All' },
            },
          },
          {
            id: 'el-open-layer',
            order: 6,
            type: 'ConsentLayerButtonElement',
            buttonAction: 'open_layer',
            targetConsentLayer: 'layer-second',
            translations: {
              en: { id: 'bt3', locale: 'en', value: 'Manage Preferences' },
            },
          },
          {
            id: 'el-noop',
            order: 7,
            type: 'ConsentLayerButtonElement',
            buttonAction: 'noop',
            translations: {
              en: { id: 'bt4', locale: 'en', value: 'Dismiss' },
            },
          },
        ],
      },
      'layer-second': {
        id: 'layer-second',
        name: 'Second Layer',
        position: 'left',
        showCloseButton: false,
        bannerApiId: 'second-layer',
        elements: [
          {
            id: 'el-header-2',
            order: 1,
            type: 'ConsentLayerTextElement',
            style: 'dg-header',
            translations: {
              en: { id: 't3', locale: 'en', value: 'Manage Cookies' },
            },
          },
          {
            id: 'el-categories',
            order: 2,
            type: 'ConsentLayerCategoryElement',
            consentLayerCategories: [
              {
                id: 'cat-essential',
                consentCategoryId: 'cat-1',
                order: 1,
                hidden: false,
                primitive: 'dg-category-essential',
                alwaysOn: true,
                gtmKey: 'dg-category-essential',
                uuids: [],
                cookiePatterns: [],
                translations: {
                  en: { id: 'ct1', locale: 'en', name: 'Essential', description: 'Required cookies', essentialLabel: 'Always On' },
                },
                showTrackingDetailsLink: false,
              },
              {
                id: 'cat-marketing',
                consentCategoryId: 'cat-2',
                order: 2,
                hidden: false,
                primitive: 'dg-category-marketing',
                alwaysOn: false,
                gtmKey: 'dg-category-marketing',
                uuids: ['vendor-1'],
                cookiePatterns: ['_fbp$'],
                translations: {
                  en: { id: 'ct2', locale: 'en', name: 'Marketing', description: 'Advertising cookies' },
                },
                showTrackingDetailsLink: false,
              },
            ],
            translations: {},
          },
          {
            id: 'el-save',
            order: 3,
            type: 'ConsentLayerButtonElement',
            buttonAction: 'save_preferences',
            translations: {
              en: { id: 'bt5', locale: 'en', value: 'Save Preferences' },
            },
          },
        ],
      },
    },
  },
};

describe('Banner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ConsentManager.getConfig.mockReturnValue(testConfig);
    ConsentManager.getPreferences.mockReturnValue({
      isCustomised: true,
      cookieOptions: [
        { gtmKey: 'dg-category-essential', isEnabled: true },
        { gtmKey: 'dg-category-marketing', isEnabled: true },
      ],
    });
  });

  it('renders null when config is not available', () => {
    ConsentManager.getConfig.mockReturnValue(null);
    const { queryByTestId } = render(<Banner />);
    expect(queryByTestId('banner-overlay')).toBeNull();
  });

  it('renders the first layer elements from config', () => {
    const { getByText } = render(<Banner locale="en" />);
    expect(getByText('Privacy Settings')).toBeTruthy();
    expect(getByText('We use cookies to improve your experience.')).toBeTruthy();
    expect(getByText('Accept All')).toBeTruthy();
    expect(getByText('Reject All')).toBeTruthy();
    expect(getByText('Manage Preferences')).toBeTruthy();
  });

  it('renders close button when showCloseButton is true', () => {
    const { getByLabelText } = render(<Banner locale="en" />);
    expect(getByLabelText('Close')).toBeTruthy();
  });

  it('calls onDismiss when close button is pressed', () => {
    const onDismiss = jest.fn();
    const { getByLabelText } = render(<Banner locale="en" onDismiss={onDismiss} />);
    fireEvent.press(getByLabelText('Close'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('calls acceptAll and onConsentSaved when accept button is pressed', async () => {
    const onConsentSaved = jest.fn();
    const { getByText } = render(<Banner locale="en" onConsentSaved={onConsentSaved} />);

    fireEvent.press(getByText('Accept All'));

    await waitFor(() => {
      expect(ConsentManager.acceptAll).toHaveBeenCalledTimes(1);
      expect(onConsentSaved).toHaveBeenCalledTimes(1);
    });
  });

  it('calls rejectAll and onConsentSaved when reject button is pressed', async () => {
    const onConsentSaved = jest.fn();
    const { getByText } = render(<Banner locale="en" onConsentSaved={onConsentSaved} />);

    fireEvent.press(getByText('Reject All'));

    await waitFor(() => {
      expect(ConsentManager.rejectAll).toHaveBeenCalledTimes(1);
      expect(onConsentSaved).toHaveBeenCalledTimes(1);
    });
  });

  it('navigates to second layer on open_layer button press', () => {
    const { getByText, queryByText } = render(<Banner locale="en" />);

    fireEvent.press(getByText('Manage Preferences'));

    // Second layer content should be visible
    expect(getByText('Manage Cookies')).toBeTruthy();
    expect(getByText('Essential')).toBeTruthy();
    expect(getByText('Marketing')).toBeTruthy();
    // First layer unique content should be gone
    expect(queryByText('We use cookies to improve your experience.')).toBeNull();
  });

  it('calls onDismiss when noop button is pressed', () => {
    const onDismiss = jest.fn();
    const { getByText } = render(<Banner locale="en" onDismiss={onDismiss} />);

    fireEvent.press(getByText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders links with correct text', () => {
    const { getByText } = render(<Banner locale="en" />);
    expect(getByText('Privacy Policy')).toBeTruthy();
  });

  it('opens URL when link is pressed', () => {
    const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const { getByText } = render(<Banner locale="en" />);

    fireEvent.press(getByText('Privacy Policy'));
    expect(openURLSpy).toHaveBeenCalledWith('https://example.com/privacy');

    openURLSpy.mockRestore();
  });

  it('saves preferences with category state on save_preferences action', async () => {
    const onConsentSaved = jest.fn();
    const { getByText } = render(<Banner locale="en" onConsentSaved={onConsentSaved} />);

    // Navigate to second layer with categories
    fireEvent.press(getByText('Manage Preferences'));
    fireEvent.press(getByText('Save Preferences'));

    await waitFor(() => {
      expect(ConsentManager.savePreferences).toHaveBeenCalledTimes(1);
      const savedPrefs = ConsentManager.savePreferences.mock.calls[0][0] as ConsentPreferences;
      expect(savedPrefs.isCustomised).toBe(true);
      expect(savedPrefs.cookieOptions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ gtmKey: 'dg-category-essential', isEnabled: true }),
          expect.objectContaining({ gtmKey: 'dg-category-marketing', isEnabled: true }),
        ]),
      );
      expect(onConsentSaved).toHaveBeenCalledWith(savedPrefs);
    });
  });

  it('saves customized toggles (not acceptAll) on custom action', async () => {
    const configWithCustomAction: ConsentConfig = {
      ...testConfig,
      layout: {
        ...testConfig.layout,
        consentLayers: {
          ...testConfig.layout.consentLayers,
          'layer-second': {
            ...testConfig.layout.consentLayers['layer-second']!,
            elements: testConfig.layout.consentLayers['layer-second']!.elements.map((element) =>
              element.id === 'el-save' ? { ...element, buttonAction: 'custom' } : element,
            ),
          },
        },
      },
    };
    ConsentManager.getConfig.mockReturnValue(configWithCustomAction);

    const onConsentSaved = jest.fn();
    const { getByText, getByLabelText } = render(<Banner locale="en" onConsentSaved={onConsentSaved} />);

    // Navigate to second layer and turn off the marketing category
    fireEvent.press(getByText('Manage Preferences'));
    fireEvent(getByLabelText('Marketing: enabled'), 'valueChange', false);
    fireEvent.press(getByText('Save Preferences'));

    await waitFor(() => {
      expect(ConsentManager.acceptAll).not.toHaveBeenCalled();
      expect(ConsentManager.savePreferences).toHaveBeenCalledTimes(1);
      const savedPrefs = ConsentManager.savePreferences.mock.calls[0][0] as ConsentPreferences;
      expect(savedPrefs.isCustomised).toBe(true);
      expect(savedPrefs.cookieOptions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ gtmKey: 'dg-category-essential', isEnabled: true }),
          expect.objectContaining({ gtmKey: 'dg-category-marketing', isEnabled: false }),
        ]),
      );
      expect(onConsentSaved).toHaveBeenCalledWith(savedPrefs);
    });
  });

  it('renders accessibility labels on buttons', () => {
    const { getByLabelText } = render(<Banner locale="en" />);
    expect(getByLabelText('Accept All')).toBeTruthy();
    expect(getByLabelText('Reject All')).toBeTruthy();
  });

  it('uses provided locale for translations', () => {
    const configWithLocale: ConsentConfig = {
      ...testConfig,
      layout: {
        ...testConfig.layout,
        consentLayers: {
          'layer-first': {
            ...testConfig.layout.consentLayers['layer-first']!,
            elements: [
              {
                id: 'el-title',
                order: 1,
                type: 'ConsentLayerTextElement',
                style: 'dg-title',
                translations: {
                  en: { id: 't1', locale: 'en', value: 'Privacy Settings' },
                  fr: { id: 't1-fr', locale: 'fr', value: 'Paramètres de confidentialité' },
                },
              },
            ],
          },
        },
      },
    };
    ConsentManager.getConfig.mockReturnValue(configWithLocale);

    const { getByText } = render(<Banner locale="fr" />);
    expect(getByText('Paramètres de confidentialité')).toBeTruthy();
  });

  it('does not render close button when showCloseButton is false', () => {
    const configNoClose: ConsentConfig = {
      ...testConfig,
      layout: {
        ...testConfig.layout,
        firstLayerId: 'layer-second',
      },
    };
    ConsentManager.getConfig.mockReturnValue(configNoClose);

    const { queryByLabelText } = render(<Banner locale="en" />);
    expect(queryByLabelText('Close')).toBeNull();
  });
});
