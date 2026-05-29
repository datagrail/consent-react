import { ConsentEventEmitter } from '../../src/consent/EventEmitter';
import type { ConsentPreferences } from '../../src/types';

describe('ConsentEventEmitter', () => {
  let emitter: ConsentEventEmitter;

  const mockPreferences: ConsentPreferences = {
    isCustomised: true,
    cookieOptions: [
      { gtmKey: 'dg-category-essential', isEnabled: true },
      { gtmKey: 'dg-category-marketing', isEnabled: false },
    ],
  };

  beforeEach(() => {
    emitter = new ConsentEventEmitter();
  });

  describe('addListener', () => {
    it('should add a listener', () => {
      emitter.addListener(jest.fn());
      expect(emitter.listenerCount).toBe(1);
    });

    it('should support multiple listeners', () => {
      emitter.addListener(jest.fn());
      emitter.addListener(jest.fn());
      emitter.addListener(jest.fn());
      expect(emitter.listenerCount).toBe(3);
    });

    it('should return an unsubscribe function', () => {
      const unsubscribe = emitter.addListener(jest.fn());
      expect(typeof unsubscribe).toBe('function');
    });

    it('should not add the same listener twice (Set behavior)', () => {
      const listener = jest.fn();
      emitter.addListener(listener);
      emitter.addListener(listener);
      expect(emitter.listenerCount).toBe(1);
    });
  });

  describe('emit', () => {
    it('should call all listeners with preferences', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      emitter.addListener(listener1);
      emitter.addListener(listener2);
      emitter.emit(mockPreferences);

      expect(listener1).toHaveBeenCalledWith(mockPreferences);
      expect(listener2).toHaveBeenCalledWith(mockPreferences);
    });

    it('should call listeners synchronously', () => {
      const order: number[] = [];

      emitter.addListener(() => order.push(1));
      emitter.addListener(() => order.push(2));
      emitter.emit(mockPreferences);

      expect(order).toEqual([1, 2]);
    });

    it('should not throw when no listeners', () => {
      expect(() => emitter.emit(mockPreferences)).not.toThrow();
    });
  });

  describe('unsubscribe', () => {
    it('should remove the listener when called', () => {
      const listener = jest.fn();
      const unsubscribe = emitter.addListener(listener);

      unsubscribe();
      emitter.emit(mockPreferences);

      expect(listener).not.toHaveBeenCalled();
      expect(emitter.listenerCount).toBe(0);
    });

    it('should only remove the specific listener', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      const unsubscribe1 = emitter.addListener(listener1);
      emitter.addListener(listener2);

      unsubscribe1();
      emitter.emit(mockPreferences);

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledWith(mockPreferences);
    });

    it('should be safe to call multiple times', () => {
      const listener = jest.fn();
      const unsubscribe = emitter.addListener(listener);

      unsubscribe();
      unsubscribe(); // second call should not throw
      expect(emitter.listenerCount).toBe(0);
    });
  });

  describe('removeAllListeners', () => {
    it('should clear all listeners', () => {
      emitter.addListener(jest.fn());
      emitter.addListener(jest.fn());
      emitter.addListener(jest.fn());

      emitter.removeAllListeners();
      expect(emitter.listenerCount).toBe(0);
    });

    it('should prevent previously added listeners from being called', () => {
      const listener = jest.fn();
      emitter.addListener(listener);

      emitter.removeAllListeners();
      emitter.emit(mockPreferences);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('listenerCount', () => {
    it('should return 0 initially', () => {
      expect(emitter.listenerCount).toBe(0);
    });

    it('should track additions and removals', () => {
      const unsub1 = emitter.addListener(jest.fn());
      expect(emitter.listenerCount).toBe(1);

      emitter.addListener(jest.fn());
      expect(emitter.listenerCount).toBe(2);

      unsub1();
      expect(emitter.listenerCount).toBe(1);
    });
  });
});
