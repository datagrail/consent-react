import type { ConsentPreferences, ConsentChangeListener, Unsubscribe } from '../types';

/**
 * Typed event emitter for consent changes.
 * Supports multiple listeners. Returns unsubscribe function.
 * Fires synchronously after storage write.
 */
export class ConsentEventEmitter {
  private listeners: Set<ConsentChangeListener> = new Set();

  // TODO: Agent implements
  addListener(_listener: ConsentChangeListener): Unsubscribe {
    throw new Error('Not implemented');
  }

  emit(_preferences: ConsentPreferences): void {
    throw new Error('Not implemented');
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}
