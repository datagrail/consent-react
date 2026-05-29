import type { ConsentPreferences, ConsentChangeListener, Unsubscribe } from '../types';

/**
 * Typed event emitter for consent changes.
 * Supports multiple listeners. Returns unsubscribe function.
 * Fires synchronously after storage write.
 */
export class ConsentEventEmitter {
  private listeners: Set<ConsentChangeListener> = new Set();

  addListener(listener: ConsentChangeListener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(preferences: ConsentPreferences): void {
    for (const listener of this.listeners) {
      listener(preferences);
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}
