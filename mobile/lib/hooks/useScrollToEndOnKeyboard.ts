// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { useCallback, useEffect, useRef } from 'react';
import { Keyboard, type ScrollView } from 'react-native';

/**
 * Brings the end of a scroll view into view once the keyboard is up, for a box whose
 * buttons sit below it at the end of the screen: the two-factor code and its Verify
 * button, which the number pad covered so the member typed blind (emulator, 7 Nov 2026).
 *
 * Attach `scrollRef` to the ScrollView and call `bringEndIntoView` from the box's
 * onFocus. If the keyboard is still opening, the scroll waits for `keyboardDidShow`
 * (and a moment for the view to shrink), and fires once for that focus only — a keyboard
 * opened by some other box leaves the screen where it is.
 *
 * 🔴 On Android the view only shrinks if the screen wraps the ScrollView in a
 * KeyboardAvoidingView: the manifest's adjustResize no longer resizes an edge-to-edge
 * window (Android 15+). Without it, the end of the content stays under the keyboard.
 * One implementation for both screens that need it (the welcome wizard and Settings →
 * Two-factor), so the next one does not grow a slightly different copy.
 */
export function useScrollToEndOnKeyboard() {
  const scrollRef = useRef<ScrollView | null>(null);
  const scrollWhenKeyboardShows = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = Keyboard.addListener('keyboardDidShow', () => {
      if (!scrollWhenKeyboardShows.current) return;
      scrollWhenKeyboardShows.current = false;
      timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    });
    return () => {
      subscription.remove();
      if (timer) clearTimeout(timer);
    };
  }, []);

  const bringEndIntoView = useCallback(() => {
    if (Keyboard.isVisible()) {
      scrollRef.current?.scrollToEnd({ animated: true });
    } else {
      scrollWhenKeyboardShows.current = true;
    }
  }, []);

  return { scrollRef, bringEndIntoView };
}
