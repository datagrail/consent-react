import React from 'react';
import { Text, TouchableOpacity, Linking, View, StyleSheet } from 'react-native';
import type { LinkItem } from '../../types';
import type { BannerTheme } from '../theme';

interface LinkElementProps {
  links: LinkItem[];
  locale: string;
  theme: BannerTheme;
}

export function LinkElement({ links, locale, theme }: LinkElementProps): React.ReactElement {
  const sortedLinks = [...links].sort((a, b) => a.order - b.order);

  return (
    <View style={[styles.container, { marginBottom: theme.spacing.md }]}>
      {sortedLinks.map((link) => {
        const translation = link.translations[locale] ?? link.translations['en'];
        const text = translation?.text ?? '';
        const url = translation?.url ?? '';

        return (
          <TouchableOpacity
            key={link.id}
            onPress={() => {
              if (url) {
                void Linking.openURL(url);
              }
            }}
            accessibilityRole="link"
            accessibilityLabel={text}
            accessibilityHint="Opens in your browser"
            style={styles.linkTouchable}
            hitSlop={{ top: 11, bottom: 11, left: 4, right: 4 }}
          >
            <Text
              style={[styles.linkText, { color: theme.colors.link, fontSize: theme.fontSize.body }]}
            >
              {text}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  linkTouchable: {
    paddingVertical: 4,
  },
  linkText: {
    textDecorationLine: 'underline',
  },
});
