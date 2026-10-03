// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Single-key shortcuts for a broker page (j / k / Enter / r / f / a / n).
 *
 * A broker working a queue should not have to reach for the mouse between
 * every message. This hook binds bare keys on the window and runs the matching
 * handler, with the guards that make bare keys safe:
 *
 *   - nothing fires while the broker is typing (input, textarea, select,
 *     contenteditable) — a search for "flag" must not flag anything;
 *   - nothing fires with Ctrl / Cmd / Alt held, so browser shortcuts win;
 *   - nothing fires inside an open dialog, so a modal's own buttons cannot
 *     trigger a second action underneath it;
 *   - Enter is left alone when a button or link has focus, because Enter
 *     already activates it.
 *
 * Keys are matched exactly against `event.key`, so `j` and `J` are different.
 * Dependency-free: no library, no context — a page calls it and passes the
 * handlers it has.
 */

import { useEffect, useRef } from 'react';

export type HotkeyMap = Record<string, (event: KeyboardEvent) => void>;

interface HotkeyOptions {
  /** Turn the whole map off (e.g. while the page is still loading). */
  enabled?: boolean;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const ACTIVATABLE_TAGS = new Set(['BUTTON', 'A', 'SUMMARY']);

/** True when a bare key pressed on this element should count as a shortcut. */
export function isHotkeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  if (TYPING_TAGS.has(target.tagName) || target.isContentEditable) return false;
  if (target.closest('[role="dialog"], [role="alertdialog"]')) return false;
  return true;
}

/** Enter already activates these; the shortcut must not run as well. */
function isActivatable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ACTIVATABLE_TAGS.has(target.tagName) || target.getAttribute('role') === 'button';
}

export function useHotkey(keyMap: HotkeyMap, { enabled = true }: HotkeyOptions = {}): void {
  // Read the latest map through a ref so a page re-render never re-subscribes.
  const mapRef = useRef(keyMap);
  mapRef.current = keyMap;

  useEffect(() => {
    if (!enabled) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const handler = mapRef.current[event.key];
      if (!handler) return;
      if (!isHotkeyTarget(event.target)) return;
      if (event.key === 'Enter' && isActivatable(event.target)) return;
      event.preventDefault();
      handler(event);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

export default useHotkey;
