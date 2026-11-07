// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React, { useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView as NativeKeyboardAvoidingView,
  Platform,
  type KeyboardAvoidingViewProps,
} from 'react-native';

/**
 * React Native's KeyboardAvoidingView, without the gap it leaves on Android once the
 * keyboard closes. Every screen uses this one; ESLint refuses the react-native import.
 *
 * 🔴 React Native 0.83 (`ReactRootView.checkForKeyboardEvents`, Android 11+) sends
 * `keyboardDidHide` with `screenY` set to the visible area's HEIGHT, not its bottom, and
 * on Android KeyboardAvoidingView recalculates its room from that event. So a screen kept
 * a band the height of the status bar (~50 dp) at the bottom after the keyboard closed,
 * on every screen with a keyboard (Android 16 emulator, 7 November 2026). The room made
 * while the keyboard is up was right; only the close was wrong. Android only, two changes:
 *
 *  - It is enabled only while the keyboard is up, so closing it always returns to no room
 *    at all, whatever React Native worked out from the close event.
 *  - `height` becomes `padding`. `height` feeds its last value into the next calculation,
 *    so a value left over from the close would make the next opening shrink too far;
 *    `padding` starts afresh every time. On every screen nothing in the layout follows the
 *    wrapper (only dialogs and sheets), so the two look the same.
 *
 * iOS is React Native's own, untouched: it reacts to keyboardWillShow / keyboardWillHide,
 * which report the right frame.
 */
export default function KeyboardAvoidingView({ behavior, enabled = true, ...rest }: KeyboardAvoidingViewProps) {
  const keyboardUp = useAndroidKeyboardUp();

  if (Platform.OS !== 'android') {
    return <NativeKeyboardAvoidingView behavior={behavior} enabled={enabled} {...rest} />;
  }
  return (
    <NativeKeyboardAvoidingView
      behavior={behavior === 'height' ? 'padding' : behavior}
      enabled={enabled && keyboardUp}
      {...rest}
    />
  );
}

/** Whether the keyboard is up, on Android; always false elsewhere (not needed there). */
function useAndroidKeyboardUp(): boolean {
  const [keyboardUp, setKeyboardUp] = useState(() => Platform.OS === 'android' && Keyboard.isVisible());

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return keyboardUp;
}
