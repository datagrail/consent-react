import type {
  DataGrailConfig,
  ConsentConfig,
  ConsentPreferences,
  ConsentChangeListener,
  Unsubscribe,
} from './types';
import { ConsentError } from './types';

// Internal state — module-level singleton pattern (matches native SDKs)
let initialized = false;
let currentConfig: ConsentConfig | null = null;

/**
 * Initialize the DataGrail Consent SDK.
 * Must be called before any other method.
 */
export async function initialize(_config: DataGrailConfig): Promise<void> {
  // TODO: Agent implements full init flow:
  // 1. Validate config
  // 2. Create StorageService
  // 3. Create NetworkService + OfflineQueue
  // 4. Create ConfigService → fetch config
  // 5. Load/resolve consent state
  // 6. Set initialized = true
  // 7. Retry pending requests (non-blocking)
  void _config;
  void initialized;
  void currentConfig;
  throw new ConsentError('NOT_INITIALIZED', 'Not implemented');
}

export function needsConsent(): boolean {
  throw new ConsentError('NOT_INITIALIZED', 'Not implemented');
}

export function showBanner(): void {
  throw new ConsentError('NOT_INITIALIZED', 'Not implemented');
}

export function isCategoryEnabled(_category: string): boolean {
  throw new ConsentError('NOT_INITIALIZED', 'Not implemented');
}

export function getPreferences(): ConsentPreferences | null {
  throw new ConsentError('NOT_INITIALIZED', 'Not implemented');
}

export function getCategories(): ConsentPreferences | null {
  throw new ConsentError('NOT_INITIALIZED', 'Not implemented');
}

export function getConfig(): ConsentConfig | null {
  return currentConfig;
}

export async function savePreferences(_prefs: ConsentPreferences): Promise<void> {
  throw new ConsentError('NOT_INITIALIZED', 'Not implemented');
}

export async function acceptAll(): Promise<void> {
  throw new ConsentError('NOT_INITIALIZED', 'Not implemented');
}

export async function rejectAll(): Promise<void> {
  throw new ConsentError('NOT_INITIALIZED', 'Not implemented');
}

export function onConsentChanged(_listener: ConsentChangeListener): Unsubscribe {
  throw new ConsentError('NOT_INITIALIZED', 'Not implemented');
}

export function reset(): void {
  throw new ConsentError('NOT_INITIALIZED', 'Not implemented');
}

export function hasUserConsent(): boolean {
  throw new ConsentError('NOT_INITIALIZED', 'Not implemented');
}

export async function retryPendingRequests(): Promise<{ success: number; failed: number }> {
  throw new ConsentError('NOT_INITIALIZED', 'Not implemented');
}

export async function trackBannerShown(): Promise<void> {
  throw new ConsentError('NOT_INITIALIZED', 'Not implemented');
}
