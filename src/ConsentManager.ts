import type {
  DataGrailConfig,
  ConsentConfig,
  ConsentPreferences,
  CategoryConsent,
  ConsentChangeListener,
  Unsubscribe,
} from './types';
import { ConsentError } from './types';
import { StorageService } from './storage/StorageService';
import { NetworkService } from './network/NetworkService';
import { OfflineQueue } from './network/OfflineQueue';
import { ConfigService } from './config/ConfigService';
import { ConsentResolver } from './consent/ConsentResolver';
import { ConsentEventEmitter } from './consent/EventEmitter';

// Internal state — module-level singleton pattern (matches native SDKs)
let initialized = false;
let currentConfig: ConsentConfig | null = null;
let storageService: StorageService | null = null;
let networkService: NetworkService | null = null;
let offlineQueue: OfflineQueue | null = null;
let configService: ConfigService | null = null;
let eventEmitter: ConsentEventEmitter = new ConsentEventEmitter();

/**
 * Initialize the DataGrail Consent SDK.
 * Must be called before any other method.
 */
export async function initialize(config: DataGrailConfig): Promise<void> {
  // 1. Validate config
  if (!config.configUrl || !config.configUrl.startsWith('https://')) {
    throw new ConsentError(
      'INVALID_CONFIGURATION',
      'configUrl must be a valid HTTPS URL',
    );
  }

  // 2. Create StorageService
  storageService = new StorageService();

  // 3. Create NetworkService + OfflineQueue
  networkService = new NetworkService();
  offlineQueue = new OfflineQueue(storageService, networkService);

  // 4. Create ConfigService and fetch config
  configService = new ConfigService(networkService, storageService);
  currentConfig = await configService.fetchConfig(config.configUrl);

  // 5. Load/resolve consent state (store version for future comparisons)
  const savedPrefs = storageService.loadPreferences();
  const savedVersion = storageService.loadConfigVersion();
  const { preferences } = ConsentResolver.resolve(currentConfig, savedPrefs, savedVersion);

  // If no saved prefs, store the defaults so isCategoryEnabled works immediately
  if (savedPrefs === null) {
    storageService.savePreferences(preferences);
    storageService.saveConfigVersion(currentConfig.version);
  }

  // 6. Set initialized
  initialized = true;

  // 7. Retry pending requests (non-blocking)
  offlineQueue.drain().catch(() => {
    // Swallow — fire and forget
  });
}

export function needsConsent(): boolean {
  assertInitialized();

  if (!currentConfig!.showBanner) {
    return false;
  }

  const savedPrefs = storageService!.loadPreferences();
  const savedVersion = storageService!.loadConfigVersion();

  if (savedPrefs === null) {
    return true;
  }

  // Version mismatch triggers reconsent
  return savedVersion !== currentConfig!.version;
}

export function showBanner(): void {
  assertInitialized();
  // This is a UI trigger — delegates to the Banner component
  // The actual banner display is handled by the UI layer (not our scope)
}

export function isCategoryEnabled(category: string): boolean {
  assertInitialized();
  const prefs = storageService!.loadPreferences();
  if (prefs === null) return false;
  const option = prefs.cookieOptions.find((opt) => opt.gtmKey === category);
  return option?.isEnabled ?? false;
}

export function getPreferences(): ConsentPreferences | null {
  assertInitialized();
  return storageService!.loadPreferences();
}

export function getCategories(): ConsentPreferences | null {
  assertInitialized();
  const saved = storageService!.loadPreferences();
  if (saved !== null) return saved;
  return ConsentResolver.getDefaults(currentConfig!);
}

export function getConfig(): ConsentConfig | null {
  return currentConfig;
}

export async function savePreferences(prefs: ConsentPreferences): Promise<void> {
  assertInitialized();

  // Save to storage
  storageService!.savePreferences(prefs);
  storageService!.saveConfigVersion(currentConfig!.version);

  // Emit event
  eventEmitter.emit(prefs);

  // POST to backend
  const consentId = storageService!.getOrCreateUniqueId();
  const timestamp = new Date().toISOString();
  const body = JSON.stringify({
    dg_customer_id: currentConfig!.dgCustomerId,
    consent_id: consentId,
    config_version: currentConfig!.version,
    is_customised: prefs.isCustomised,
    cookie_options: prefs.cookieOptions.map((opt) => ({
      gtm_key: opt.gtmKey,
      is_enabled: opt.isEnabled,
    })),
    timestamp,
  });

  const url = `https://${currentConfig!.privacyDomain}/save_preferences`;

  try {
    await networkService!.request({
      url,
      method: 'POST',
      body,
    });
  } catch {
    // On network failure, queue for later
    offlineQueue!.enqueue({ url, method: 'POST', body }, '/save_preferences');
  }
}

export async function acceptAll(): Promise<void> {
  assertInitialized();
  const allCategories = ConsentResolver.getAllCategories(currentConfig!);
  const cookieOptions: CategoryConsent[] = allCategories.map((gtmKey) => ({
    gtmKey,
    isEnabled: true,
  }));

  await savePreferences({
    isCustomised: false,
    cookieOptions,
  });
}

export async function rejectAll(): Promise<void> {
  assertInitialized();
  const allCategories = ConsentResolver.getAllCategories(currentConfig!);
  const essentialCategories = new Set(ConsentResolver.getEssentialCategories(currentConfig!));

  const cookieOptions: CategoryConsent[] = allCategories.map((gtmKey) => ({
    gtmKey,
    isEnabled: essentialCategories.has(gtmKey),
  }));

  await savePreferences({
    isCustomised: false,
    cookieOptions,
  });
}

export function onConsentChanged(listener: ConsentChangeListener): Unsubscribe {
  return eventEmitter.addListener(listener);
}

export function reset(): void {
  if (storageService) {
    storageService.clearAll();
  }
  currentConfig = null;
  initialized = false;
  eventEmitter.removeAllListeners();
}

export function hasUserConsent(): boolean {
  assertInitialized();
  return storageService!.loadPreferences() !== null;
}

export async function retryPendingRequests(): Promise<{ success: number; failed: number }> {
  assertInitialized();
  return offlineQueue!.drain();
}

export async function trackBannerShown(): Promise<void> {
  assertInitialized();

  const consentId = storageService!.getOrCreateUniqueId();
  const timestamp = new Date().toISOString();
  const params = new URLSearchParams({
    dg_customer_id: currentConfig!.dgCustomerId,
    consent_id: consentId,
    config_version: currentConfig!.version,
    timestamp,
  });

  const url = `https://${currentConfig!.privacyDomain}/save_open?${params.toString()}`;

  try {
    await networkService!.request({ url, method: 'GET' });
  } catch {
    // Non-critical — swallow errors for analytics
  }
}

function assertInitialized(): void {
  if (!initialized) {
    throw new ConsentError('NOT_INITIALIZED', 'SDK not initialized. Call initialize() first.');
  }
}
