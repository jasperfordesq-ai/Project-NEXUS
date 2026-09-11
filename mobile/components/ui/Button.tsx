// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { View, type ViewStyle, type StyleProp } from 'react-native';
import { Spinner } from 'heroui-native';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import * as Haptics from '@/lib/haptics';
import { CHROME_MAX_FONT_SCALE } from '@/lib/ui/textScale';
import { contrastText } from '@/lib/utils/color';
import { useAccentForeground } from '@/lib/theme/accentForeground';

// Legacy variant names kept for backwards compatibility with 32 importing screens.
// 'solid' is mapped to HeroUI's 'primary'.
type LegacyVariant = 'solid' | 'outline' | 'ghost' | 'secondary' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  children: React.ReactNode;
  variant?: LegacyVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  /** Custom tenant color — applied via inline style override. */
  color?: string;
  fullWidth?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  className?: string;
  accessibilityLabel?: string;
  testID?: string;
  /**
   * Vibrate on press. Defaults to true for `solid` and `danger`, false otherwise.
   *
   * 🔴 It used to fire on every press of every variant, which meant the app buzzed on
   * ordinary navigation — Back, "See all", a ghost link — as loudly as it did on sending
   * credits. A signal given for everything is a signal for nothing. `solid` and `danger`
   * are the variants this app uses for the primary action of a screen and for destructive
   * ones, which is where the confirmation is worth feeling. Audit 2026-09-09, item 15.
   *
   * Pass it explicitly to override in either direction.
   */
  haptic?: boolean;
}

/** Variants whose press is worth feeling: the screen's main action, and destructive ones. */
const HAPTIC_BY_DEFAULT: ReadonlySet<LegacyVariant> = new Set<LegacyVariant>(['solid', 'danger']);

const VARIANT_MAP: Record<LegacyVariant, 'primary' | 'outline' | 'ghost' | 'secondary' | 'danger'> = {
  solid: 'primary',
  outline: 'outline',
  ghost: 'ghost',
  secondary: 'secondary',
  danger: 'danger',
};

export default function Button({
  children,
  variant = 'solid',
  size = 'md',
  isLoading = false,
  color,
  fullWidth = false,
  disabled = false,
  onPress,
  style,
  className,
  accessibilityLabel,
  testID,
  haptic,
}: ButtonProps) {
  // The spinner on a solid accent button must be the same colour as the label beside it.
  const accentForeground = useAccentForeground();
  const shouldVibrate = haptic ?? HAPTIC_BY_DEFAULT.has(variant);
  const handlePress = () => {
    if (shouldVibrate) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.();
  };

  const wrapperStyle: StyleProp<ViewStyle> = [
    fullWidth && { width: '100%' },
    color && variant === 'solid' && { backgroundColor: color },
    style,
    { minHeight: 48, minWidth: 48 },
  ];

  return (
    <HeroButton
      variant={VARIANT_MAP[variant]}
      size={size}
      isDisabled={disabled || isLoading}
      onPress={handlePress}
      style={wrapperStyle}
      className={className}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: isLoading, disabled: disabled || isLoading }}
      testID={testID}
    >
      {/*
        🔴 The label stays while loading. Swapping it for a bare spinner (the old
        behaviour) left a sighted member looking at an anonymous pill and a screen
        reader with nothing to announce mid-action (audit 2026-09-05, F08). The
        spinner sits beside the text; `busy` in accessibilityState says why it is
        not responding. Duplicate taps are already blocked by `isDisabled`.
      */}
      {isLoading ? (
        <View className="flex-row items-center gap-2">
          <Spinner size="sm" color={variant === 'solid' ? (color ? contrastText(color) : accentForeground) : color ?? 'default'} />
          {typeof children === 'string' ? (
            <HeroButton.Label maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>{children}</HeroButton.Label>
          ) : children}
        </View>
      ) : typeof children === 'string' ? (
        /*
          Capped, because a button's label sits in a row with other controls and at an
          uncapped 2.0 system font scale it pushed them off the screen. 1.6 is as far as the
          widest button ("Turn on notifications") can grow before it truncates — see
          lib/ui/textScale.ts for why body text is deliberately NOT capped.
        */
        <HeroButton.Label maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>{children}</HeroButton.Label>
      ) : (
        children
      )}
    </HeroButton>
  );
}
