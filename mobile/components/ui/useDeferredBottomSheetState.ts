// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef, useState } from 'react';

/**
 * Long enough for HeroUI Native's bottom-sheet close animation to finish before
 * the sheet is unmounted. The library animates the sheet closed when `isOpen`
 * goes true→false (a reanimated spring, ~300ms); if we unmount synchronously
 * the moment `visible` becomes false the exit animation is destroyed — the sheet
 * just vanishes. This is the close-side counterpart to the open-side deferral
 * below.
 */
const CLOSE_ANIMATION_MS = 350;

/**
 * How long the open flip waits after mount.
 *
 * The library only animates a sheet IN when it observes `isOpen` going
 * false→true while already mounted (its content container compares the previous
 * value and calls `snapToIndex` on the transition). Mounting already-open shows
 * nothing. One frame's budget is enough for the sheet container to measure
 * before that snap arrives.
 */
const OPEN_DEFER_MS = 90;

/**
 * How long after the open flip the library's close events are ignored.
 *
 * HeroUI Native's swipe-close detector watches an animation progress value and
 * treats anything past 1.5 as a pan-down dismissal. During the opening spring
 * that threshold can be crossed without anyone touching the screen, emitting a
 * spurious `onOpenChange(false)`. A real pan-down dismissal cannot complete
 * inside the open animation, so ignoring early close events is safe.
 */
const OPEN_SETTLE_MS = 350;

/**
 * Drives a HeroUI Native bottom sheet from a parent `visible` boolean while
 * respecting the library's controlled lifecycle:
 *
 * - `mounted` keeps the sheet in the tree only while it is open OR animating
 *   closed, so a closed sheet does not keep a portal mounted over the screen.
 * - `open` (mapped to the sheet's `isOpen`) starts false on mount and flips true
 *   one frame later, which is the transition the library animates on.
 * - On `visible` → false, `open` flips to false immediately (the library plays
 *   the close animation) and the unmount is deferred by CLOSE_ANIMATION_MS so
 *   that animation can finish. Re-opening before then cancels the unmount.
 *
 * 🔴 **Do not add a second "re-assert" open flip.** From 2026-08-15 to
 * 2026-08-21 this hook flipped `open` true, then bounced it false→true again
 * 220 ms later, on the theory that the first `snapToIndex` could be swallowed by
 * a sheet that had not measured yet. That bounce was itself what stopped every
 * sheet in the app from working, and it did so in the most misleading way
 * available: the sheet DID open, visibly slid up, and then closed itself again
 * within about a third of a second — so every screenshot taken a second or two
 * after the tap showed nothing, and the button read as dead. Four repair
 * attempts went into the open/close lifecycle and into the portal before anyone
 * caught the sheet in the act.
 *
 * Why the bounce closes the sheet: flipping `open` back to false makes the
 * library's content container call `close()`, which drives its animation
 * progress toward the "closing" end. Its own swipe-close detector then reads
 * that as a dismissal and fires `onOpenChange(false)` for real. The bounce
 * therefore manufactured exactly the spurious close that the rest of this hook
 * exists to defend against.
 *
 * Measured on an emulator on 2026-08-21, three open/close rounds each way:
 * without the bounce the sheet is open and settled at +3 s in 3/3 rounds; with
 * the bounce restored it is closed in 3/3. `bottomSheetOpenFlip.test.ts` guards
 * the sequence.
 */
export function useDeferredBottomSheetState(visible: boolean) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedAtRef = useRef(0);

  useEffect(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    if (!visible) {
      // Animate closed (true→false), then unmount once the animation is done.
      setOpen(false);
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null;
        setMounted(false);
      }, CLOSE_ANIMATION_MS);
      return () => {
        if (closeTimerRef.current) {
          clearTimeout(closeTimerRef.current);
          closeTimerRef.current = null;
        }
      };
    }

    // Mount closed; the second effect flips `open` true so the library can
    // animate the sheet into view.
    setMounted(true);
    setOpen(false);

    return undefined;
  }, [visible]);

  useEffect(() => {
    if (!visible || !mounted) return undefined;

    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null;
      openedAtRef.current = Date.now();
      setOpen(true);
    }, OPEN_DEFER_MS);

    return () => {
      if (openTimerRef.current) {
        clearTimeout(openTimerRef.current);
        openTimerRef.current = null;
      }
    };
  }, [mounted, visible]);

  /**
   * Whether an onOpenChange(false) from the library should be honoured as a
   * real dismissal. False while the sheet is still opening (see
   * OPEN_SETTLE_MS) or not open at all.
   */
  const shouldHonorClose = () =>
    open && Date.now() - openedAtRef.current > OPEN_SETTLE_MS;

  return { mounted, open, shouldHonorClose };
}
