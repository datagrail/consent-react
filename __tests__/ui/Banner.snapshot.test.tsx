import React from 'react';
import { act } from 'react-test-renderer';
import renderer from 'react-test-renderer';
import { Banner } from '../../src/ui/Banner';
import type { ConsentConfig } from '../../src/types';

// Use fake timers to prevent Animated.timing cleanup errors.
// Appearance and AccessibilityInfo are mocked globally in jest.setup.ts so the
// reduce-motion effect resolves synchronously inside act().
jest.useFakeTimers();

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
};

function makeConfig(overrides: {
  position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  showCloseButton?: boolean;
}): ConsentConfig {
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
      firstLayerId: 'layer-first',
      gpcDntLayerId: null,
      consentLayers: {
        'layer-first': {
          id: 'layer-first',
          name: 'First Layer',
          position: overrides.position ?? 'bottom',
          showCloseButton: overrides.showCloseButton ?? true,
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
              id: 'el-accept',
              order: 3,
              type: 'ConsentLayerButtonElement',
              buttonAction: 'accept_all',
              translations: {
                en: { id: 'bt1', locale: 'en', value: 'Accept All' },
              },
            },
            {
              id: 'el-reject',
              order: 4,
              type: 'ConsentLayerButtonElement',
              buttonAction: 'reject_all',
              translations: {
                en: { id: 'bt2', locale: 'en', value: 'Reject All' },
              },
            },
          ],
        },
      },
    },
  };
}

describe('Banner Snapshots', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ConsentManager.getPreferences.mockReturnValue({
      isCustomised: true,
      cookieOptions: [
        { gtmKey: 'dg-category-essential', isEnabled: true },
        { gtmKey: 'dg-category-marketing', isEnabled: true },
      ],
    });
  });

  // The banner mounts hidden and flips to visible in an effect, then runs its
  // entrance animation. Capture the tree only after mount effects have
  // committed and timers have flushed — grabbing toJSON() inside the create()
  // act() would snapshot the initial null render before `visible` is set.
  function renderBannerTree(): renderer.ReactTestRendererJSON | renderer.ReactTestRendererJSON[] {
    let component!: renderer.ReactTestRenderer;
    act(() => {
      component = renderer.create(<Banner locale="en" />);
    });
    act(() => {
      jest.runAllTimers();
    });
    const tree = component.toJSON();
    if (tree == null) {
      throw new Error('Banner rendered null; expected a visible dialog to snapshot');
    }
    return tree;
  }

  it('renders with bottom position', () => {
    const config = makeConfig({ position: 'bottom', showCloseButton: true });
    ConsentManager.getConfig.mockReturnValue(config);

    expect(renderBannerTree()).toMatchSnapshot();
  });

  it('renders with center position', () => {
    const config = makeConfig({ position: 'center', showCloseButton: true });
    ConsentManager.getConfig.mockReturnValue(config);

    expect(renderBannerTree()).toMatchSnapshot();
  });

  it('renders with close button', () => {
    const config = makeConfig({ position: 'bottom', showCloseButton: true });
    ConsentManager.getConfig.mockReturnValue(config);

    expect(renderBannerTree()).toMatchSnapshot();
  });

  it('renders without close button', () => {
    const config = makeConfig({ position: 'bottom', showCloseButton: false });
    ConsentManager.getConfig.mockReturnValue(config);

    expect(renderBannerTree()).toMatchSnapshot();
  });
});
