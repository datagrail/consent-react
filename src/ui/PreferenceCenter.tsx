import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import type {
  PreferenceCenterProps,
  ConsentConfig,
  ConsentLayerCategory,
  ConsentPreferences,
} from '../types';
import { useTheme } from './theme';
import type { BannerTheme } from './theme';
import { ConsentToggle } from './components/ConsentToggle';
import * as ConsentManager from '../ConsentManager';

/**
 * Preference center with category toggles grouped by purpose.
 * Supports save/cancel, tracking details expansion, accessibility.
 */
export function PreferenceCenter({
  onSave,
  onCancel,
  locale,
  showTrackingDetails,
}: PreferenceCenterProps): React.ReactElement {
  const config = ConsentManager.getConfig();
  const theme = useTheme(config);
  // No device-locale detection: React Native has no zero-dependency API for
  // reading the device locale, so we default to 'en'. Add real detection if a
  // locale library is ever pulled in.
  const resolvedLocale = locale ?? 'en';

  const categories = useMemo(() => {
    if (!config) return [];
    return findCategories(config);
  }, [config]);

  const [toggleState, setToggleState] = useState<Record<string, boolean>>({});
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  // Initialize toggle state from current preferences or initial categories
  useEffect(() => {
    if (!config) return;
    const prefs = ConsentManager.getCategories();
    const initialState: Record<string, boolean> = {};

    for (const category of categories) {
      if (category.alwaysOn) {
        initialState[category.gtmKey] = true;
      } else if (prefs) {
        const opt = prefs.cookieOptions.find((o) => o.gtmKey === category.gtmKey);
        initialState[category.gtmKey] = opt?.isEnabled ?? false;
      } else {
        initialState[category.gtmKey] = config.initialCategories.initial.includes(category.gtmKey);
      }
    }

    setToggleState(initialState);
  }, [config, categories]);

  const handleToggle = useCallback((gtmKey: string, value: boolean) => {
    setToggleState((prev) => ({ ...prev, [gtmKey]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    const preferences: ConsentPreferences = {
      isCustomised: true,
      cookieOptions: Object.entries(toggleState).map(([gtmKey, isEnabled]) => ({
        gtmKey,
        isEnabled,
      })),
    };
    await ConsentManager.savePreferences(preferences);
    onSave?.(preferences);
  }, [toggleState, onSave]);

  const handleCancel = useCallback(() => {
    // Reset toggles to initial state
    if (!config) return;
    const prefs = ConsentManager.getCategories();
    const resetState: Record<string, boolean> = {};

    for (const category of categories) {
      if (category.alwaysOn) {
        resetState[category.gtmKey] = true;
      } else if (prefs) {
        const opt = prefs.cookieOptions.find((o) => o.gtmKey === category.gtmKey);
        resetState[category.gtmKey] = opt?.isEnabled ?? false;
      } else {
        resetState[category.gtmKey] = config.initialCategories.initial.includes(category.gtmKey);
      }
    }

    setToggleState(resetState);
    onCancel?.();
  }, [config, categories, onCancel]);

  const toggleExpanded = useCallback((categoryId: string) => {
    setExpandedCategories((prev) => ({ ...prev, [categoryId]: !prev[categoryId] }));
  }, []);

  const headerText = getHeaderText(config, resolvedLocale);

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      accessibilityLabel="Privacy preference center"
      testID="preference-center"
    >
      <Header text={headerText} theme={theme} />
      <ScrollView style={styles.scrollView} testID="category-list">
        {categories
          .filter((cat) => !cat.hidden)
          .sort((a, b) => a.order - b.order)
          .map((category) => (
            <CategoryRow
              key={category.id}
              category={category}
              locale={resolvedLocale}
              theme={theme}
              isEnabled={toggleState[category.gtmKey] ?? false}
              isExpanded={expandedCategories[category.id] ?? false}
              showTrackingDetails={showTrackingDetails ?? false}
              onToggle={handleToggle}
              onToggleExpand={toggleExpanded}
            />
          ))}
      </ScrollView>
      <Footer theme={theme} onSave={handleSave} onCancel={handleCancel} />
    </View>
  );
}

interface HeaderProps {
  text: string;
  theme: BannerTheme;
}

function Header({ text, theme }: HeaderProps): React.ReactElement {
  return (
    <View
      style={[
        styles.header,
        {
          borderBottomColor: theme.colors.border,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
        },
      ]}
    >
      <Text
        style={[styles.headerText, { color: theme.colors.text, fontSize: theme.fontSize.title }]}
        accessibilityRole="header"
      >
        {text}
      </Text>
    </View>
  );
}

interface CategoryRowProps {
  category: ConsentLayerCategory;
  locale: string;
  theme: BannerTheme;
  isEnabled: boolean;
  isExpanded: boolean;
  showTrackingDetails: boolean;
  onToggle: (gtmKey: string, value: boolean) => void;
  onToggleExpand: (categoryId: string) => void;
}

function CategoryRow({
  category,
  locale,
  theme,
  isEnabled,
  isExpanded,
  showTrackingDetails,
  onToggle,
  onToggleExpand,
}: CategoryRowProps): React.ReactElement {
  const translation = category.translations[locale] ?? category.translations['en'];
  const name = translation?.name ?? category.gtmKey;
  const description = translation?.description ?? '';
  const essentialLabel = translation?.essentialLabel ?? 'Always On';

  return (
    <View
      style={[
        styles.categoryRow,
        {
          borderBottomColor: theme.colors.border,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
        },
      ]}
    >
      <View style={styles.categoryMain}>
        <TouchableOpacity
          style={styles.categoryInfo}
          onPress={() => onToggleExpand(category.id)}
          accessibilityRole="button"
          accessibilityLabel={`${name} details`}
          accessibilityHint={isExpanded ? 'Collapses category details' : 'Expands category details'}
          accessibilityState={{ expanded: isExpanded }}
          testID={`category-details-${category.gtmKey}`}
        >
          <Text
            style={[
              styles.categoryName,
              { color: theme.colors.text, fontSize: theme.fontSize.body },
            ]}
          >
            {name}
          </Text>
          {description ? (
            <Text
              style={[
                styles.expandIndicator,
                { color: theme.colors.link, fontSize: theme.fontSize.small },
              ]}
            >
              {isExpanded ? 'Hide details' : 'Show details'}
            </Text>
          ) : null}
        </TouchableOpacity>
        <View style={styles.categoryToggle}>
          <ConsentToggle
            name={name}
            gtmKey={category.gtmKey}
            alwaysOn={category.alwaysOn}
            essentialLabel={essentialLabel}
            isEnabled={isEnabled}
            theme={theme}
            onToggle={onToggle}
            testIDPrefix="toggle-"
          />
        </View>
      </View>
      {isExpanded && description ? (
        <Text
          style={[
            styles.categoryDescription,
            {
              color: theme.colors.text,
              fontSize: theme.fontSize.small,
              marginTop: theme.spacing.sm,
            },
          ]}
        >
          {description}
        </Text>
      ) : null}
      {isExpanded && showTrackingDetails ? (
        <TrackingDetails category={category} theme={theme} />
      ) : null}
    </View>
  );
}

interface TrackingDetailsProps {
  category: ConsentLayerCategory;
  theme: BannerTheme;
}

function TrackingDetails({ category, theme }: TrackingDetailsProps): React.ReactElement {
  return (
    <View
      style={[styles.trackingDetails, { marginTop: theme.spacing.sm }]}
      testID={`tracking-details-${category.gtmKey}`}
    >
      {category.cookiePatterns.length > 0 && (
        <View style={styles.trackingSection}>
          <Text
            style={[
              styles.trackingLabel,
              { color: theme.colors.text, fontSize: theme.fontSize.small },
            ]}
          >
            Cookie Patterns:
          </Text>
          {category.cookiePatterns.map((pattern, idx) => (
            <Text
              key={`${category.id}-pattern-${idx}`}
              style={[
                styles.trackingItem,
                { color: theme.colors.text, fontSize: theme.fontSize.small },
              ]}
            >
              {pattern}
            </Text>
          ))}
        </View>
      )}
      {category.uuids.length > 0 && (
        <View style={styles.trackingSection}>
          <Text
            style={[
              styles.trackingLabel,
              { color: theme.colors.text, fontSize: theme.fontSize.small },
            ]}
          >
            Vendor IDs:
          </Text>
          {category.uuids.map((uuid, idx) => (
            <Text
              key={`${category.id}-uuid-${idx}`}
              style={[
                styles.trackingItem,
                { color: theme.colors.text, fontSize: theme.fontSize.small },
              ]}
            >
              {uuid}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

interface FooterProps {
  theme: BannerTheme;
  onSave: () => void;
  onCancel: () => void;
}

function Footer({ theme, onSave, onCancel }: FooterProps): React.ReactElement {
  return (
    <View
      style={[
        styles.footer,
        {
          borderTopColor: theme.colors.border,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
        },
      ]}
    >
      <TouchableOpacity
        style={[
          styles.footerButton,
          {
            backgroundColor: theme.colors.buttonPrimary,
            borderRadius: theme.borderRadius,
            paddingVertical: theme.spacing.sm + 4,
          },
        ]}
        onPress={onSave}
        accessibilityRole="button"
        accessibilityLabel="Save preferences"
        testID="save-button"
      >
        <Text
          style={[
            styles.footerButtonText,
            { color: theme.colors.buttonPrimaryText, fontSize: theme.fontSize.button },
          ]}
        >
          Save
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[
          styles.footerButton,
          {
            backgroundColor: theme.colors.buttonSecondary,
            borderRadius: theme.borderRadius,
            paddingVertical: theme.spacing.sm + 4,
            marginTop: theme.spacing.sm,
          },
        ]}
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel="Cancel"
        testID="cancel-button"
      >
        <Text
          style={[
            styles.footerButtonText,
            { color: theme.colors.buttonSecondaryText, fontSize: theme.fontSize.button },
          ]}
        >
          Cancel
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function findCategories(config: ConsentConfig): ConsentLayerCategory[] {
  for (const layer of Object.values(config.layout.consentLayers)) {
    for (const element of layer.elements) {
      if (element.type === 'ConsentLayerCategoryElement' && element.consentLayerCategories) {
        return element.consentLayerCategories;
      }
    }
  }
  return [];
}

function getHeaderText(config: ConsentConfig | null, locale: string): string {
  if (!config) return 'Privacy Settings';

  // Look for a title element in any layer
  for (const layer of Object.values(config.layout.consentLayers)) {
    for (const element of layer.elements) {
      if (element.type === 'ConsentLayerTextElement' && element.style === 'dg-title') {
        const translation = element.translations?.[locale] ?? element.translations?.['en'];
        if (translation?.value) return translation.value;
      }
    }
  }
  return 'Privacy Settings';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: {
    fontWeight: 'bold',
  },
  scrollView: {
    flex: 1,
  },
  categoryRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  categoryMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  categoryInfo: {
    flex: 1,
    marginRight: 16,
  },
  categoryName: {
    fontWeight: '500',
  },
  expandIndicator: {
    marginTop: 4,
  },
  categoryToggle: {
    alignItems: 'flex-end',
  },
  categoryDescription: {
    opacity: 0.8,
  },
  trackingDetails: {
    paddingLeft: 8,
  },
  trackingSection: {
    marginBottom: 8,
  },
  trackingLabel: {
    fontWeight: '600',
    marginBottom: 4,
  },
  trackingItem: {
    paddingLeft: 8,
    marginBottom: 2,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerButtonText: {
    fontWeight: 'bold',
  },
});
