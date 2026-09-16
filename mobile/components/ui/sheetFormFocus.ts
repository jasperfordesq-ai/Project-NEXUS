// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { createContext, useContext, useImperativeHandle, useRef, type ForwardedRef } from 'react';
import type { TextInput } from 'react-native';

export const SheetFormFocusContext = createContext<((input: TextInput | null) => void) | null>(null);

/** Shared by Input and TextArea; harmless outside a scrolling sheet. */
export function useSheetFormFocus(forwardedRef: ForwardedRef<TextInput>) {
  const inputRef = useRef<TextInput>(null);
  const focus = useContext(SheetFormFocusContext);
  useImperativeHandle(forwardedRef, () => inputRef.current!);
  return {
    inputRef,
    inSheet: focus !== null,
    reveal: () => focus?.(inputRef.current),
    blur: () => focus?.(null),
  };
}

/** Reveal the entire editor when it fits; otherwise keep its top reachable. */
export function fieldScrollDelta(top: number, height: number, viewportTop: number, viewportBottom: number) {
  const start = viewportTop + 12;
  const end = viewportBottom - 12;
  if (end <= start) return 0;
  if (top < start || height > end - start) return top - start;
  return Math.max(0, top + height - end);
}
