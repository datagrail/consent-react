/**
 * Global Jest setup (setupFilesAfterEnv).
 *
 * The Banner mounts an effect that calls
 * `AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion)`. With the
 * real async mock, that promise resolves on a later microtask — after the
 * synchronous `render()` has returned — so the resulting state update lands
 * outside React's `act()` scope and prints an "update not wrapped in act(...)"
 * warning in every UI test.
 *
 * We replace it with a synchronously-resolving thenable. The `.then` callback
 * runs during the effect's commit (which the test renderer already wraps in
 * `act`), so the state update is batched and no warning is emitted. Tests that
 * need a specific value can still override this per-test.
 */
import { AccessibilityInfo, Appearance } from 'react-native';

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => {
    const thenable = {
      then(onFulfilled: (value: boolean) => unknown) {
        onFulfilled(false);
        return thenable;
      },
      catch() {
        return thenable;
      },
    };
    return thenable as unknown as Promise<boolean>;
  });

  jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('light');
  jest.spyOn(Appearance, 'addChangeListener').mockReturnValue({ remove: jest.fn() });
});
