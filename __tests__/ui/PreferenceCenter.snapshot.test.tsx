import React from 'react';
import { act } from 'react-test-renderer';
import renderer from 'react-test-renderer';
import { Appearance } from 'react-native';
import { PreferenceCenter } from '../../src/ui/PreferenceCenter';
import type { ConsentConfig } from '../../src/types';

// Mock Appearance to prevent addChangeListener errors in react-test-renderer
jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('light');
jest.spyOn(Appearance, 'addChangeListener').mockReturnValue({ remove: jest.fn() });

jest.mock('../../src/ConsentManager', () => ({
  getConfig: jest.fn(),
  getCategories: jest.fn(),
  getPreferences: jest.fn(),
  savePreferences: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ConsentManager = require('../../src/ConsentManager') as {
  getConfig: jest.Mock;
  getCategories: jest.Mock;
  getPreferences: jest.Mock;
};

function makeConfig(overrides?: {
  includeAlwaysOn?: boolean;
  categoryCount?: number;
}): ConsentConfig {
  const includeAlwaysOn = overrides?.includeAlwaysOn ?? false;
  const categoryCount = overrides?.categoryCount ?? 3;

  const categories = [];

  if (includeAlwaysOn) {
    categories.push({
      id: 'cat-essential',
      consentCategoryId: 'cat-1',
      order: 1,
      hidden: false,
      primitive: 'dg-category-essential',
      alwaysOn: true,
      gtmKey: 'dg-category-essential',
      uuids: [],
      cookiePatterns: ['session_id$'],
      translations: {
        en: {
          id: 'ct1',
          locale: 'en',
          name: 'Essential',
          description: 'Required for the website to function. Cannot be disabled.',
          essentialLabel: 'Always On',
        },
      },
      showTrackingDetailsLink: false,
    });
  }

  const additionalCategories = [
    {
      id: 'cat-marketing',
      consentCategoryId: 'cat-2',
      order: includeAlwaysOn ? 2 : 1,
      hidden: false,
      primitive: 'dg-category-marketing',
      alwaysOn: false,
      gtmKey: 'dg-category-marketing',
      uuids: ['vendor-1', 'vendor-2'],
      cookiePatterns: ['_fbp$', '_ga$'],
      translations: {
        en: {
          id: 'ct2',
          locale: 'en',
          name: 'Marketing',
          description: 'Used for targeted advertising and tracking across sites.',
        },
      },
      showTrackingDetailsLink: false,
    },
    {
      id: 'cat-performance',
      consentCategoryId: 'cat-3',
      order: includeAlwaysOn ? 3 : 2,
      hidden: false,
      primitive: 'dg-category-performance',
      alwaysOn: false,
      gtmKey: 'dg-category-performance',
      uuids: ['analytics-vendor'],
      cookiePatterns: ['_gid$', '_ga_'],
      translations: {
        en: {
          id: 'ct3',
          locale: 'en',
          name: 'Performance',
          description: 'Help us measure and improve site performance.',
        },
      },
      showTrackingDetailsLink: false,
    },
    {
      id: 'cat-functional',
      consentCategoryId: 'cat-4',
      order: includeAlwaysOn ? 4 : 3,
      hidden: false,
      primitive: 'dg-category-functional',
      alwaysOn: false,
      gtmKey: 'dg-category-functional',
      uuids: [],
      cookiePatterns: ['_hjSession_'],
      translations: {
        en: {
          id: 'ct4',
          locale: 'en',
          name: 'Functional',
          description: 'Enable enhanced functionality and personalization.',
        },
      },
      showTrackingDetailsLink: false,
    },
  ];

  // Take up to categoryCount (minus 1 if alwaysOn is included)
  const toTake = includeAlwaysOn ? categoryCount - 1 : categoryCount;
  categories.push(...additionalCategories.slice(0, toTake));

  return {
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
      firstLayerId: 'layer-prefs',
      gpcDntLayerId: null,
      consentLayers: {
        'layer-prefs': {
          id: 'layer-prefs',
          name: 'Preferences Layer',
          position: 'center',
          showCloseButton: false,
          bannerApiId: 'prefs-layer',
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
              id: 'el-categories',
              order: 2,
              type: 'ConsentLayerCategoryElement',
              consentLayerCategories: categories,
              translations: {},
            },
          ],
        },
      },
    },
  };
}

describe('PreferenceCenter Snapshots', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ConsentManager.getCategories.mockReturnValue(null);
    ConsentManager.getPreferences.mockReturnValue(null);
  });

  it('renders with multiple categories', () => {
    const config = makeConfig({ categoryCount: 3 });
    ConsentManager.getConfig.mockReturnValue(config);

    let tree: renderer.ReactTestRendererJSON | renderer.ReactTestRendererJSON[] | null = null;
    act(() => {
      tree = renderer.create(<PreferenceCenter locale="en" />).toJSON();
    });
    expect(tree).toMatchSnapshot();
  });

  it('renders with always-on category', () => {
    const config = makeConfig({ includeAlwaysOn: true, categoryCount: 3 });
    ConsentManager.getConfig.mockReturnValue(config);

    let tree: renderer.ReactTestRendererJSON | renderer.ReactTestRendererJSON[] | null = null;
    act(() => {
      tree = renderer.create(<PreferenceCenter locale="en" />).toJSON();
    });
    expect(tree).toMatchSnapshot();
  });

  it('renders with expanded description', () => {
    const config = makeConfig({ includeAlwaysOn: true, categoryCount: 3 });
    ConsentManager.getConfig.mockReturnValue(config);

    let tree: renderer.ReactTestRendererJSON | renderer.ReactTestRendererJSON[] | null = null;
    act(() => {
      tree = renderer.create(
        <PreferenceCenter locale="en" showTrackingDetails={true} />,
      ).toJSON();
    });
    expect(tree).toMatchSnapshot();
  });
});
