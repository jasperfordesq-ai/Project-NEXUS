// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CelebrationHost — a member's first offer, event or group (warmth phase 5).
 *
 * Lives in the page layout, so it is still there after the form that saved
 * the item has navigated to it. It listens for `celebrate()` (lib/celebrate)
 * and shows, for a few seconds, a burst of confetti in the community's
 * colours and a line of thanks.
 *
 *  - Decoration that never gets in the way: the layer ignores clicks, takes
 *    no focus, and clears itself.
 *  - The words are announced politely (role="status"), so a screen-reader
 *    user hears them without being interrupted.
 *  - A member who asked for less motion gets the words and no confetti.
 *  - Once per member and kind on this device: remembered in localStorage, so
 *    a repeated server answer (a retry, a second tab) does not celebrate twice.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PartyPopper from 'lucide-react/icons/party-popper';
import { ConfettiCelebration } from '@/components/ui/ConfettiCelebration';
import { useReducedMotion } from '@/lib/motion';
import { CELEBRATE_EVENT, CELEBRATION_KINDS, type CelebrationKind } from '@/lib/celebrate';
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/safeStorage';

/** Each kind's two lines, as literal keys (the i18n checks read them from here). */
const WORDS: Record<CelebrationKind, { title: string; text: string }> = {
  first_listing: { title: 'celebration_first_listing_title', text: 'celebration_first_listing_text' },
  first_event: { title: 'celebration_first_event_title', text: 'celebration_first_event_text' },
  first_group: { title: 'celebration_first_group_title', text: 'celebration_first_group_text' },
};

/** Long enough to read two short lines; short enough not to linger. */
const SHOWN_FOR_MS = 6000;

function seenKey(memberId: number, kind: CelebrationKind): string {
  return `nexus_celebrated:${memberId}:${kind}`;
}

export function CelebrationHost({ memberId }: { memberId: number | null | undefined }) {
  const { t } = useTranslation('common');
  const reducedMotion = useReducedMotion();
  const [kind, setKind] = useState<CelebrationKind | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!memberId) return undefined;

    const onCelebrate = (event: Event) => {
      const asked = (event as CustomEvent<unknown>).detail;
      if (typeof asked !== 'string' || !(CELEBRATION_KINDS as readonly string[]).includes(asked)) return;
      const next = asked as CelebrationKind;
      if (safeLocalStorageGet(seenKey(memberId, next)) !== null) return;
      safeLocalStorageSet(seenKey(memberId, next), new Date().toISOString());

      if (timer.current) clearTimeout(timer.current);
      setKind(next);
      timer.current = setTimeout(() => setKind(null), SHOWN_FOR_MS);
    };

    window.addEventListener(CELEBRATE_EVENT, onCelebrate);
    return () => {
      window.removeEventListener(CELEBRATE_EVENT, onCelebrate);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [memberId]);

  if (!kind) return null;

  return (
    <div
      data-testid="celebration-layer"
      className="pointer-events-none fixed inset-x-0 top-24 z-[60] flex justify-center px-4"
    >
      <div className="relative w-full max-w-md">
        {!reducedMotion && <ConfettiCelebration show />}
        <div
          data-testid="celebration"
          role="status"
          className="relative flex items-center gap-3 rounded-2xl border border-accent/25 bg-surface p-4 shadow-lg"
        >
          <span
            aria-hidden="true"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-soft-foreground"
          >
            <PartyPopper className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-base font-semibold text-foreground">{t(WORDS[kind].title)}</span>
            <span className="block text-sm text-muted">{t(WORDS[kind].text)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export default CelebrationHost;
