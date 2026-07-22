import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import type { BannerTheme } from '../theme';

interface CloseButtonProps {
  onPress: () => void;
  theme: BannerTheme;
}

export function CloseButton({ onPress, theme }: CloseButtonProps): React.ReactElement {
  return (
    <TouchableOpacity
      style={styles.button}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Close"
      accessibilityHint="Dismisses the consent dialog"
      testID="banner-close"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={[styles.text, { color: theme.colors.text }]}>{'✕'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 1,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 18,
    fontWeight: 'bold',
  },
});
