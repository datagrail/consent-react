import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { PreferenceCenter } from '../../src/ui/PreferenceCenter';
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
  dc: null,
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
  trackingDetailsUrl: 'https://example.com/metadata.json',
  consentMode: 'optin',
  showBanner: true,
  consentPolicy: { name: 'GDPR', default: true },
  gppUsNat: false,
  initialCategories: {
    respectGpc: true,
    respectDnt: true,
    respectOptout: false,
    initial: ['dg-category-essential', 'dg-category-functional'],
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
    firstLayerId: 'layer-1',
    gpcDntLayerId: null,
    consentLayers: {
      'layer-1': {
        id: 'layer-1',
        name: 'Main Layer',
        position: 'center',
        showCloseButton: true,
        bannerApiId: 'main-layer',
        elements: [
          {
            id: 'el-title',
            order: 1,
            type: 'ConsentLayerTextElement',
            style: 'dg-title',
            translations: {
              en: { id: 't1', locale: 'en', value: 'Your Privacy Choices' },
            },
          },
          {
            id: 'el-categories',
            order: 2,
            type: 'ConsentLayerCategoryElement',
            consentLayerCategories: [
              {
                id: 'cat-essential',
                consentCategoryId: 'cc-1',
                order: 1,
                hidden: false,
                primitive: 'dg-category-essential',
                alwaysOn: true,
                gtmKey: 'dg-category-essential',
                uuids: ['vendor-abc', 'vendor-def'],
                cookiePatterns: ['session_id$', 'csrf_token$'],
                translations: {
                  en: {
                    id: 'ct1',
                    locale: 'en',
                    name: 'Essential',
                    description: 'These cookies are required for the site to function.',
                    essentialLabel: 'Always On',
                  },
                  fr: {
                    id: 'ct1-fr',
                    locale: 'fr',
                    name: 'Essentiel',
                    description: 'Ces cookies sont requis.',
                    essentialLabel: 'Toujours actif',
                  },
                },
                showTrackingDetailsLink: false,
              },
              {
                id: 'cat-marketing',
                consentCategoryId: 'cc-2',
                order: 2,
                hidden: false,
                primitive: 'dg-category-marketing',
                alwaysOn: false,
                gtmKey: 'dg-category-marketing',
                uuids: ['vendor-xyz'],
                cookiePatterns: ['_fbp$', '_ga$'],
                translations: {
                  en: {
                    id: 'ct2',
                    locale: 'en',
                    name: 'Marketing',
                    description: 'Used for targeted advertising.',
                  },
                },
                showTrackingDetailsLink: false,
              },
              {
                id: 'cat-functional',
                consentCategoryId: 'cc-3',
                order: 3,
                hidden: false,
                primitive: 'dg-category-functional',
                alwaysOn: false,
                gtmKey: 'dg-category-functional',
                uuids: [],
                cookiePatterns: ['_hjSession$'],
                translations: {
                  en: {
                    id: 'ct3',
                    locale: 'en',
                    name: 'Functional',
                    description: 'Enhanced functionality and personalization.',
                  },
                },
                showTrackingDetailsLink: false,
              },
              {
                id: 'cat-hidden',
                consentCategoryId: 'cc-4',
                order: 4,
                hidden: true,
                primitive: 'dg-category-hidden',
                alwaysOn: false,
                gtmKey: 'dg-category-hidden',
                uuids: [],
                cookiePatterns: [],
                translations: {
                  en: {
                    id: 'ct4',
                    locale: 'en',
                    name: 'Hidden Category',
                    description: 'Should not show.',
                  },
                },
                showTrackingDetailsLink: false,
              },
            ],
            translations: {},
          },
        ],
      },
    },
  },
};

describe('PreferenceCenter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ConsentManager.getConfig.mockReturnValue(testConfig);
    ConsentManager.getCategories.mockReturnValue({
      isCustomised: false,
      cookieOptions: [
        { gtmKey: 'dg-category-essential', isEnabled: true },
        { gtmKey: 'dg-category-marketing', isEnabled: false },
        { gtmKey: 'dg-category-functional', isEnabled: true },
      ],
    });
  });

  it('renders the preference center with header', () => {
    const { getByText } = render(<PreferenceCenter locale="en" />);
    expect(getByText('Your Privacy Choices')).toBeTruthy();
  });

  it('renders visible categories', () => {
    const { getByText, queryByText } = render(<PreferenceCenter locale="en" />);
    expect(getByText('Essential')).toBeTruthy();
    expect(getByText('Marketing')).toBeTruthy();
    expect(getByText('Functional')).toBeTruthy();
    expect(queryByText('Hidden Category')).toBeNull();
  });

  it('shows Always On label for alwaysOn categories', () => {
    const { getByLabelText } = render(<PreferenceCenter locale="en" />);
    expect(getByLabelText('Essential: Always On')).toBeTruthy();
  });

  it('renders toggles for non-alwaysOn categories', () => {
    const { getByTestId } = render(<PreferenceCenter locale="en" />);
    expect(getByTestId('toggle-dg-category-marketing')).toBeTruthy();
    expect(getByTestId('toggle-dg-category-functional')).toBeTruthy();
  });

  it('initializes toggles from getCategories preferences', () => {
    const { getByTestId } = render(<PreferenceCenter locale="en" />);
    // Marketing was set to false in getCategories mock
    const marketingToggle = getByTestId('toggle-dg-category-marketing');
    expect(marketingToggle.props.value).toBe(false);

    // Functional was set to true in getCategories mock
    const functionalToggle = getByTestId('toggle-dg-category-functional');
    expect(functionalToggle.props.value).toBe(true);
  });

  it('toggles category on user interaction', () => {
    const { getByTestId } = render(<PreferenceCenter locale="en" />);
    const marketingToggle = getByTestId('toggle-dg-category-marketing');

    fireEvent(marketingToggle, 'valueChange', true);
    expect(getByTestId('toggle-dg-category-marketing').props.value).toBe(true);
  });

  it('calls savePreferences and onSave when Save is pressed', async () => {
    const onSave = jest.fn();
    const { getByTestId } = render(<PreferenceCenter locale="en" onSave={onSave} />);

    fireEvent.press(getByTestId('save-button'));

    await waitFor(() => {
      expect(ConsentManager.savePreferences).toHaveBeenCalledTimes(1);
      const saved = ConsentManager.savePreferences.mock.calls[0][0] as ConsentPreferences;
      expect(saved.isCustomised).toBe(true);
      expect(saved.cookieOptions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ gtmKey: 'dg-category-essential', isEnabled: true }),
          expect.objectContaining({ gtmKey: 'dg-category-marketing', isEnabled: false }),
          expect.objectContaining({ gtmKey: 'dg-category-functional', isEnabled: true }),
        ]),
      );
      expect(onSave).toHaveBeenCalledWith(saved);
    });
  });

  it('resets toggles and calls onCancel when Cancel is pressed', () => {
    const onCancel = jest.fn();
    const { getByTestId } = render(<PreferenceCenter locale="en" onCancel={onCancel} />);

    // Toggle marketing on
    const marketingToggle = getByTestId('toggle-dg-category-marketing');
    fireEvent(marketingToggle, 'valueChange', true);
    expect(getByTestId('toggle-dg-category-marketing').props.value).toBe(true);

    // Cancel should reset to initial
    fireEvent.press(getByTestId('cancel-button'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(getByTestId('toggle-dg-category-marketing').props.value).toBe(false);
  });

  it('shows description when category is expanded', () => {
    const { getByText, queryByText, getByLabelText } = render(<PreferenceCenter locale="en" />);

    expect(queryByText('Used for targeted advertising.')).toBeNull();
    fireEvent.press(getByLabelText('Marketing details'));
    expect(getByText('Used for targeted advertising.')).toBeTruthy();
  });

  it('shows tracking details when expanded and showTrackingDetails is true', () => {
    const { getByLabelText, getByTestId } = render(
      <PreferenceCenter locale="en" showTrackingDetails />,
    );

    fireEvent.press(getByLabelText('Marketing details'));
    const details = getByTestId('tracking-details-dg-category-marketing');
    expect(details).toBeTruthy();
  });

  it('does not show tracking details when showTrackingDetails is false', () => {
    const { getByLabelText, queryByTestId } = render(
      <PreferenceCenter locale="en" showTrackingDetails={false} />,
    );

    fireEvent.press(getByLabelText('Marketing details'));
    expect(queryByTestId('tracking-details-dg-category-marketing')).toBeNull();
  });

  it('renders accessibility labels and checked state on toggles', () => {
    const { getByLabelText } = render(<PreferenceCenter locale="en" />);
    expect(getByLabelText('Marketing').props.accessibilityState).toEqual({ checked: false });
    expect(getByLabelText('Functional').props.accessibilityState).toEqual({ checked: true });
  });

  it('exposes expanded state on category details controls', () => {
    const { getByLabelText } = render(<PreferenceCenter locale="en" />);
    const marketingDetails = getByLabelText('Marketing details');

    expect(marketingDetails.props.accessibilityState).toEqual({ expanded: false });
    fireEvent.press(marketingDetails);
    expect(getByLabelText('Marketing details').props.accessibilityState).toEqual({
      expanded: true,
    });
  });

  it('uses provided locale for translations', () => {
    const { getByText, getByLabelText } = render(<PreferenceCenter locale="fr" />);
    expect(getByText('Essentiel')).toBeTruthy();
    expect(getByLabelText('Essentiel: Toujours actif')).toBeTruthy();
  });

  it('falls back to initialCategories when getCategories returns null', () => {
    ConsentManager.getCategories.mockReturnValue(null);
    const { getByTestId } = render(<PreferenceCenter locale="en" />);

    // Marketing is NOT in initialCategories.initial, so should be false
    expect(getByTestId('toggle-dg-category-marketing').props.value).toBe(false);
    // Functional IS in initialCategories.initial
    expect(getByTestId('toggle-dg-category-functional').props.value).toBe(true);
  });

  it('renders Save and Cancel buttons with accessibility labels', () => {
    const { getByLabelText } = render(<PreferenceCenter locale="en" />);
    expect(getByLabelText('Save preferences')).toBeTruthy();
    expect(getByLabelText('Cancel')).toBeTruthy();
  });
});
