import type { ConsentConfig } from '../types';

export interface BannerTheme {
  colors: {
    background: string;
    text: string;
    buttonPrimary: string;
    buttonPrimaryText: string;
    buttonSecondary: string;
    buttonSecondaryText: string;
    link: string;
    border: string;
    toggleOn: string;
    toggleOff: string;
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
  };
  borderRadius: number;
  fontSize: {
    title: number;
    body: number;
    small: number;
    button: number;
  };
}

// TODO: Agent implements
export function extractTheme(_config: ConsentConfig, _isDarkMode?: boolean): BannerTheme {
  throw new Error('Not implemented');
}

export const DEFAULT_LIGHT_THEME: BannerTheme = {
  colors: {
    background: '#FFFFFF',
    text: '#1A1A1A',
    buttonPrimary: '#6366F1',
    buttonPrimaryText: '#FFFFFF',
    buttonSecondary: '#E5E7EB',
    buttonSecondaryText: '#374151',
    link: '#6366F1',
    border: '#E5E7EB',
    toggleOn: '#6366F1',
    toggleOff: '#D1D5DB',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  borderRadius: 12,
  fontSize: { title: 20, body: 14, small: 12, button: 16 },
};

export const DEFAULT_DARK_THEME: BannerTheme = {
  colors: {
    background: '#1F2937',
    text: '#F9FAFB',
    buttonPrimary: '#818CF8',
    buttonPrimaryText: '#FFFFFF',
    buttonSecondary: '#374151',
    buttonSecondaryText: '#E5E7EB',
    link: '#818CF8',
    border: '#374151',
    toggleOn: '#818CF8',
    toggleOff: '#4B5563',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  borderRadius: 12,
  fontSize: { title: 20, body: 14, small: 12, button: 16 },
};
