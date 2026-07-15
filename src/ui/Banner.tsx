import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Animated,
  StyleSheet,
  Dimensions,
  AccessibilityInfo,
} from 'react-native';
import type {
  BannerProps,
  ConsentConfig,
  ConsentLayer,
  ConsentLayerElement,
  ButtonAction,
  ConsentPreferences,
  ConsentLayerCategory,
} from '../types';
import { useTheme } from './theme';
import type { BannerTheme } from './theme';
import { TextElement } from './components/TextElement';
import { ButtonElement } from './components/ButtonElement';
import { LinkElement } from './components/LinkElement';
import { CategoryElement } from './components/CategoryElement';
import { CloseButton } from './components/CloseButton';
import * as ConsentManager from '../ConsentManager';

/**
 * Config-driven consent banner component.
 * Renders text, buttons, links from remote config.
 * Supports position variants, animations, and accessibility.
 */
export function Banner({ onConsentSaved, onDismiss, locale }: BannerProps): React.ReactElement | null {
  const config = ConsentManager.getConfig();
  const theme = useTheme(config);
  const [currentLayerId, setCurrentLayerId] = useState<string | null>(null);
  const [enabledCategories, setEnabledCategories] = useState<Record<string, boolean>>({});
  const [visible, setVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const animValue = useRef(new Animated.Value(0)).current;

  // No device-locale detection: React Native has no zero-dependency API for
  // reading the device locale, so we default to 'en'. Add real detection if a
  // locale library is ever pulled in.
  const resolvedLocale = locale ?? 'en';

  const initializeCategoryState = useCallback((cfg: ConsentConfig) => {
    const categories = findAllCategories(cfg);
    const initialState: Record<string, boolean> = {};
    const initialEnabled = cfg.initialCategories.initial;
    for (const category of categories) {
      initialState[category.gtmKey] = category.alwaysOn || initialEnabled.includes(category.gtmKey);
    }
    setEnabledCategories(initialState);
  }, []);

  // Initialize layer state from config
  useEffect(() => {
    if (config) {
      setCurrentLayerId(config.layout.firstLayerId);
      initializeCategoryState(config);
      setVisible(true);
    }
  }, [config, initializeCategoryState]);

  // Check reduce motion preference
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      setReduceMotion(enabled);
    }).catch(() => {
      // Default to no reduce motion
    });
  }, []);

  // Run animation when visible changes
  useEffect(() => {
    if (visible) {
      if (reduceMotion) {
        animValue.setValue(1);
      } else {
        Animated.timing(animValue, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();
      }
    }
  }, [visible, reduceMotion, animValue]);

  const handleButtonAction = useCallback(async (action: ButtonAction, element: ConsentLayerElement) => {
    switch (action) {
      case 'accept_all': {
        await ConsentManager.acceptAll();
        const prefs = ConsentManager.getPreferences();
        if (prefs && onConsentSaved) {
          onConsentSaved(prefs);
        }
        setVisible(false);
        break;
      }
      case 'reject_all': {
        await ConsentManager.rejectAll();
        const prefs = ConsentManager.getPreferences();
        if (prefs && onConsentSaved) {
          onConsentSaved(prefs);
        }
        setVisible(false);
        break;
      }
      case 'save_preferences':
      case 'custom': {
        const preferences: ConsentPreferences = {
          isCustomised: true,
          cookieOptions: Object.entries(enabledCategories).map(([gtmKey, isEnabled]) => ({
            gtmKey,
            isEnabled,
          })),
        };
        await ConsentManager.savePreferences(preferences);
        if (onConsentSaved) {
          onConsentSaved(preferences);
        }
        setVisible(false);
        break;
      }
      case 'open_layer': {
        const targetLayer = element.targetConsentLayer;
        if (targetLayer) {
          setCurrentLayerId(targetLayer);
        }
        break;
      }
      case 'noop': {
        onDismiss?.();
        setVisible(false);
        break;
      }
    }
  }, [enabledCategories, onConsentSaved, onDismiss]);

  const handleCategoryToggle = useCallback((gtmKey: string, enabled: boolean) => {
    setEnabledCategories((prev) => ({ ...prev, [gtmKey]: enabled }));
  }, []);

  const handleDismiss = useCallback(() => {
    onDismiss?.();
    setVisible(false);
  }, [onDismiss]);

  if (!config || !currentLayerId || !visible) {
    return null;
  }

  const layer = config.layout.consentLayers[currentLayerId];
  if (!layer) {
    return null;
  }

  const positionStyle = getPositionStyle(layer.position, animValue);
  const sortedElements = [...layer.elements].sort((a, b) => a.order - b.order);

  return (
    <View style={styles.overlay} testID="banner-overlay">
      <Animated.View
        style={[
          styles.container,
          {
            backgroundColor: theme.colors.background,
            borderRadius: theme.borderRadius,
            padding: theme.spacing.lg,
          },
          positionStyle.containerStyle,
          { transform: positionStyle.transform },
        ]}
        accessibilityRole="alert"
        testID="banner-container"
      >
        {layer.showCloseButton && (
          <CloseButton onPress={handleDismiss} theme={theme} />
        )}
        {sortedElements.map((element) => (
          <ElementRenderer
            key={element.id}
            element={element}
            theme={theme}
            locale={resolvedLocale}
            enabledCategories={enabledCategories}
            onButtonAction={handleButtonAction}
            onCategoryToggle={handleCategoryToggle}
          />
        ))}
      </Animated.View>
    </View>
  );
}

interface ElementRendererProps {
  element: ConsentLayerElement;
  theme: BannerTheme;
  locale: string;
  enabledCategories: Record<string, boolean>;
  onButtonAction: (action: ButtonAction, element: ConsentLayerElement) => void;
  onCategoryToggle: (gtmKey: string, enabled: boolean) => void;
}

function ElementRenderer({
  element,
  theme,
  locale,
  enabledCategories,
  onButtonAction,
  onCategoryToggle,
}: ElementRendererProps): React.ReactElement | null {
  const translation = element.translations?.[locale] ?? element.translations?.['en'];
  const text = translation?.value ?? '';

  switch (element.type) {
    case 'ConsentLayerTextElement':
      return <TextElement text={text} style={element.style} theme={theme} />;

    case 'ConsentLayerButtonElement':
      return (
        <ButtonElement
          text={text}
          action={element.buttonAction ?? 'noop'}
          theme={theme}
          onPress={(action) => onButtonAction(action, element)}
        />
      );

    case 'ConsentLayerLinkElement':
      return element.links ? (
        <LinkElement links={element.links} locale={locale} theme={theme} />
      ) : null;

    case 'ConsentLayerCategoryElement':
      return element.consentLayerCategories ? (
        <CategoryElement
          categories={element.consentLayerCategories}
          locale={locale}
          theme={theme}
          enabledCategories={enabledCategories}
          onToggle={onCategoryToggle}
        />
      ) : null;

    default:
      return null;
  }
}

function findAllCategories(config: ConsentConfig): ConsentLayerCategory[] {
  const categories: ConsentLayerCategory[] = [];
  for (const layer of Object.values(config.layout.consentLayers)) {
    for (const element of layer.elements) {
      if (element.type === 'ConsentLayerCategoryElement' && element.consentLayerCategories) {
        categories.push(...element.consentLayerCategories);
      }
    }
  }
  return categories;
}

interface PositionResult {
  containerStyle: Record<string, unknown>;
  transform: Animated.WithAnimatedValue<{ translateY: Animated.AnimatedInterpolation<number> } | { translateX: Animated.AnimatedInterpolation<number> }>[];
}

function getPositionStyle(
  position: ConsentLayer['position'],
  animValue: Animated.Value,
): PositionResult {
  const { height, width } = Dimensions.get('window');

  switch (position) {
    case 'bottom':
      return {
        containerStyle: {
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
        },
        transform: [
          {
            translateY: animValue.interpolate({
              inputRange: [0, 1],
              outputRange: [height * 0.5, 0],
            }),
          },
        ],
      };
    case 'top':
      return {
        containerStyle: {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
        },
        transform: [
          {
            translateY: animValue.interpolate({
              inputRange: [0, 1],
              outputRange: [-height * 0.5, 0],
            }),
          },
        ],
      };
    case 'left':
      return {
        containerStyle: {
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: width * 0.85,
          maxWidth: 400,
        },
        transform: [
          {
            translateX: animValue.interpolate({
              inputRange: [0, 1],
              outputRange: [-width, 0],
            }),
          },
        ],
      };
    case 'right':
      return {
        containerStyle: {
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: width * 0.85,
          maxWidth: 400,
        },
        transform: [
          {
            translateX: animValue.interpolate({
              inputRange: [0, 1],
              outputRange: [width, 0],
            }),
          },
        ],
      };
    case 'center':
    default:
      return {
        containerStyle: {
          alignSelf: 'center',
          width: width * 0.9,
          maxWidth: 500,
          maxHeight: height * 0.8,
        },
        transform: [
          {
            translateY: animValue.interpolate({
              inputRange: [0, 1],
              outputRange: [50, 0],
            }),
          },
        ],
      };
  }
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  container: {
    overflow: 'hidden',
  },
});
