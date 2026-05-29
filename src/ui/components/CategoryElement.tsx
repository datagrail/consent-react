import React from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import type { ConsentLayerCategory } from '../../types';
import type { BannerTheme } from '../theme';

interface CategoryElementProps {
  categories: ConsentLayerCategory[];
  locale: string;
  theme: BannerTheme;
  enabledCategories: Record<string, boolean>;
  onToggle: (gtmKey: string, enabled: boolean) => void;
}

export function CategoryElement({
  categories,
  locale,
  theme,
  enabledCategories,
  onToggle,
}: CategoryElementProps): React.ReactElement {
  const sortedCategories = [...categories]
    .filter((cat) => !cat.hidden)
    .sort((a, b) => a.order - b.order);

  return (
    <View style={[styles.container, { marginBottom: theme.spacing.md }]}>
      {sortedCategories.map((category) => {
        const translation = category.translations[locale] ?? category.translations['en'];
        const name = translation?.name ?? category.gtmKey;
        const isEnabled = category.alwaysOn || (enabledCategories[category.gtmKey] ?? false);
        const essentialLabel = translation?.essentialLabel ?? 'Always On';

        return (
          <View
            key={category.id}
            style={[styles.row, { borderBottomColor: theme.colors.border, paddingVertical: theme.spacing.sm }]}
          >
            <View style={styles.info}>
              <Text style={[styles.name, { color: theme.colors.text, fontSize: theme.fontSize.body }]}>
                {name}
              </Text>
            </View>
            {category.alwaysOn ? (
              <Text
                style={[styles.alwaysOn, { color: theme.colors.toggleOn, fontSize: theme.fontSize.small }]}
                accessibilityLabel={`${name}: ${essentialLabel}`}
              >
                {essentialLabel}
              </Text>
            ) : (
              <Switch
                value={isEnabled}
                onValueChange={(value) => onToggle(category.gtmKey, value)}
                trackColor={{ false: theme.colors.toggleOff, true: theme.colors.toggleOn }}
                accessibilityLabel={`${name}: ${isEnabled ? 'enabled' : 'disabled'}`}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  info: {
    flex: 1,
    marginRight: 16,
  },
  name: {
    fontWeight: '500',
  },
  alwaysOn: {
    fontWeight: '600',
  },
});
