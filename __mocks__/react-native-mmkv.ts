/**
 * Jest mock for react-native-mmkv.
 * Provides an in-memory implementation for unit testing.
 * Instances with the same ID share state (matching real MMKV behavior).
 */

const stores = new Map<string, Map<string, string | number | boolean>>();

export class MMKV {
  private store: Map<string, string | number | boolean>;
  private id: string;

  constructor(options?: { id?: string }) {
    this.id = options?.id ?? 'default';
    if (!stores.has(this.id)) {
      stores.set(this.id, new Map());
    }
    this.store = stores.get(this.id)!;
  }

  set(key: string, value: string | number | boolean): void {
    this.store.set(key, value);
  }

  getString(key: string): string | undefined {
    const v = this.store.get(key);
    return typeof v === 'string' ? v : undefined;
  }

  getNumber(key: string): number | undefined {
    const v = this.store.get(key);
    return typeof v === 'number' ? v : undefined;
  }

  getBoolean(key: string): boolean | undefined {
    const v = this.store.get(key);
    return typeof v === 'boolean' ? v : undefined;
  }

  contains(key: string): boolean {
    return this.store.has(key);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clearAll(): void {
    this.store.clear();
  }

  getAllKeys(): string[] {
    return Array.from(this.store.keys());
  }
}

/**
 * Reset all stores between tests.
 * Call in beforeEach/afterEach if needed.
 */
export function __resetAllStores(): void {
  stores.clear();
}
