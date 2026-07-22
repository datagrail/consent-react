import React from 'react';
import { Text, Switch, StyleSheet } from 'react-native';
import type { BannerTheme } from '../theme';

interface ConsentToggleProps {
  /** Category display name — used as the switch/label accessibility label. */
  name: string;
  /** gtmKey of the category, also used to build the testID. */
  gtmKey: string;
  /** When true, renders a static "always on" label instead of a switch. */
  alwaysOn: boolean;
  /** Label shown (and announced) for always-on categories, e.g. "Always On". */
  essentialLabel: string;
  /** Current enabled state (ignored when alwaysOn). */
  isEnabled: boolean;
  theme: BannerTheme;
  onToggle: (gtmKey: string, enabled: boolean) => void;
  /**
   * Prefix for the switch testID, so callers keep their existing IDs
   * (`banner-toggle-` in the banner, `toggle-` in the preference center).
   */
  testIDPrefix: string;
}

/**
 * Shared consent category control: an always-on label or a Switch, with the
 * accessibility semantics both the Banner and PreferenceCenter rows need.
 * Extracted so per-toggle a11y/behavior changes only have to be made once.
 */
export function ConsentToggle({
  name,
  gtmKey,
  alwaysOn,
  essentialLabel,
  isEnabled,
  theme,
  onToggle,
  testIDPrefix,
}: ConsentToggleProps): React.ReactElement {
  if (alwaysOn) {
    return (
      <Text
        style={[styles.alwaysOn, { color: theme.colors.toggleOn, fontSize: theme.fontSize.small }]}
        accessibilityLabel={`${name}: ${essentialLabel}`}
      >
        {essentialLabel}
      </Text>
    );
  }

  return (
    <Switch
      value={isEnabled}
      onValueChange={(value) => onToggle(gtmKey, value)}
      trackColor={{ false: theme.colors.toggleOff, true: theme.colors.toggleOn }}
      accessibilityLabel={name}
      accessibilityRole="switch"
      accessibilityState={{ checked: isEnabled }}
      testID={`${testIDPrefix}${gtmKey}`}
    />
  );
}

const styles = StyleSheet.create({
  alwaysOn: {
    fontWeight: '600',
  },
});
