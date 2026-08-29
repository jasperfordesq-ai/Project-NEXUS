// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React, { useCallback } from 'react';
import { Pressable } from 'react-native';
import type {
  AccessibilityRole,
  AccessibilityState,
  GestureResponderEvent,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { PressableFeedback } from 'heroui-native';

import * as Haptics from '@/lib/haptics';

type NativePressableFeedback = 'scale' | 'highlight' | 'ripple' | 'none';

interface NativePressableProps {
  children: React.ReactNode;
  onPress?: (event: GestureResponderEvent) => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  feedback?: NativePressableFeedback;
  haptics?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  /**
   * Passed through so a row that represents a CHOICE can announce whether it is the
   * chosen one. Without it a screen reader reads every option identically, and the
   * selected state exists only as a colour — which is also a contrast-only signal.
   */
  accessibilityState?: AccessibilityState;
  testID?: string;
  className?: string;
  contentClassName?: string;
  style?: StyleProp<ViewStyle>;
}

export default function NativePressable({
  children,
  onPress,
  onLongPress,
  disabled = false,
  feedback = 'scale',
  haptics = true,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityState,
  testID,
  className,
  contentClassName,
  style,
}: NativePressableProps) {
  const handlePress = useCallback((event: GestureResponderEvent) => {
    if (disabled) return;
    if (haptics) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress?.(event);
  }, [disabled, haptics, onPress]);

  const useScale = feedback !== 'none';
  const FeedbackRoot = PressableFeedback;

  // `feedback="none"` is also the escape hatch for controls that need React
  // Native's own press responder without HeroUI's animated wrapper. This is
  // important for automation and accessibility-driven activation on iOS: the
  // tenant picker was exposed to XCTest as enabled and Maestro tapped its exact
  // bounds, but PressableFeedback never delivered the press callback.
  if (!FeedbackRoot || feedback === 'none') {
    return (
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={accessibilityRole}
        accessibilityState={accessibilityState}
        className={`overflow-hidden ${className ?? ''}`}
        disabled={disabled}
        onLongPress={onLongPress}
        onPress={handlePress}
        style={style}
        testID={testID}
      >
        {children}
      </Pressable>
    );
  }

  const Scale = FeedbackRoot.Scale;
  const Highlight = FeedbackRoot.Highlight;
  const Ripple = FeedbackRoot.Ripple;

  return (
    <FeedbackRoot
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState}
      animation={useScale ? false : 'disable-all'}
      className={`overflow-hidden ${className ?? ''}`}
      isDisabled={disabled}
      onLongPress={onLongPress}
      onPress={handlePress}
      style={style}
      testID={testID}
    >
      {useScale && Scale ? (
        <Scale className={contentClassName}>
          {children}
        </Scale>
      ) : (
        children
      )}
      {feedback === 'highlight' && Highlight ? <Highlight /> : null}
      {feedback === 'ripple' && Ripple ? <Ripple /> : null}
    </FeedbackRoot>
  );
}
