import type { ConsentConfig } from '../types';
import type { NetworkService } from '../network/NetworkService';
import type { StorageService } from '../storage/StorageService';
import type { ConfigServiceOptions } from './types';

/**
 * Fetches remote config, parses snake_case JSON → camelCase types,
 * caches in MMKV with TTL. Supports stale-while-revalidate.
 */
export class ConfigService {
  constructor(
    private readonly network: NetworkService,
    private readonly storage: StorageService,
    private readonly options: ConfigServiceOptions = {},
  ) {}

  // TODO: Agent implements
  async fetchConfig(_configUrl: string): Promise<ConsentConfig> {
    void this.network;
    void this.storage;
    void this.options;
    throw new Error('Not implemented');
  }

  /**
   * Parse raw snake_case JSON string into typed ConsentConfig.
   * Exported for testing.
   */
  static parseConfig(_raw: string): ConsentConfig {
    throw new Error('Not implemented');
  }
}
