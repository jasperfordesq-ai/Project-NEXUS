// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The small padlock a menu shows beside a link a signed-out visitor cannot
 * open yet (owner, 13 Nov 2026). Whether to show it is decided by
 * `showsSignInLock()` in `signInRequired.ts`; this is only the mark.
 *
 * Deliberately quiet. On a community with everything switched on, about three
 * in four of a visitor's links carry one, so it is small (sized from the
 * label's own text, so it stays in proportion on every menu), in the muted
 * text colour, and takes no line of its own: it sits on the label's line and
 * is pushed to the far edge by the caller (`ms-auto`) where the row has an
 * edge, so a column of them reads as one tidy rule rather than as clutter.
 *
 * `text-theme-muted`, not the fainter-sounding `text-theme-subtle`: muted is
 * the shade measured to pass contrast in both themes, and the phone menu's
 * tests refuse `subtle` outright.
 *
 * The words are for people who cannot see the padlock (they become part of
 * the link's name) and for a mouse resting on it (the tooltip).
 */

import { useTranslation } from 'react-i18next';
import Lock from 'lucide-react/icons/lock';

export interface SignInLockProps {
  /** Placement only — e.g. `ms-auto` to push it to the end of a row. */
  className?: string;
}

export function SignInLock({ className = '' }: SignInLockProps) {
  const { t } = useTranslation('common');
  const label = t('nav.sign_in_to_open');

  return (
    <span
      data-sign-in-lock
      title={label}
      className={`inline-flex shrink-0 items-center text-theme-muted ${className}`}
    >
      {/* `m-0!`: HeroUI gives every icon inside a button a 4px block margin,
          which made a locked row 2px taller than an open one. */}
      <Lock className="m-0! size-[0.85em]" strokeWidth={2.25} aria-hidden="true" />
      {/* The comma gives a screen reader a pause: "Members, sign in to open". */}
      <span className="sr-only">, {label}</span>
    </span>
  );
}

export default SignInLock;
