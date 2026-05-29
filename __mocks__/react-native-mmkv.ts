/**
 * Jest mock for react-native-mmkv.
 * Provides an in-memory implementation for unit testing.
 */
export class MMKV {
  private store: Map<string, string | number | boolean> = new Map();

  constructor(_options?: { id?: string }) {}

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
