// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Account-deletion confirmation gate, ported from the web app's
 * `react-frontend/src/pages/settings/deleteConfirmation.ts` so both clients behave the
 * same way. It is a port rather than a shared module because nothing is shared between
 * the two trees at runtime; the two implementations must stay in step, and
 * `settings-delete-account.test.tsx` asserts the behaviour that matters.
 *
 * Two rules, each learned from a real failure on the web:
 *
 *  1. **The keyword the screen tells you to type must work.** The web app compared against
 *     a hardcoded English "DELETE" while some locales translated the on-screen keyword
 *     (es "ELIMINAR", fr "SUPPRIMER"), so members following the instruction in front of
 *     them could never unlock deletion. Both the localized keyword and the canonical
 *     English one are accepted, permanently.
 *  2. **Matching is case-insensitive and trimmed.** Refusing to delete an account because
 *     someone typed "delete" or left a trailing space is a self-inflicted GDPR failure.
 *     The real gate is the password the server re-authenticates.
 *
 * The web app's third concern — password managers autofilling the confirmation field —
 * does not arise here: a React Native `TextInput` with `autoComplete="off"` is not
 * autofilled by a browser, and the field is not adjacent to a saved credential pair in a
 * form the OS recognises.
 */

/** The canonical, locale-independent confirmation keyword. Always accepted. */
export const CANONICAL_DELETE_KEYWORD = 'DELETE';

/**
 * Returns true when `input` matches the confirmation keyword.
 *
 * @param input            Raw value typed into the confirmation field.
 * @param localizedKeyword The keyword the screen instructed the member to type (the
 *                         translated placeholder). Optional — when omitted only the
 *                         canonical keyword is accepted.
 */
export function isDeleteConfirmed(input: string, localizedKeyword?: string): boolean {
  const normalized = input.trim().toUpperCase();
  if (normalized.length === 0) return false;

  if (normalized === CANONICAL_DELETE_KEYWORD) return true;

  const localized = (localizedKeyword ?? '').trim().toUpperCase();
  return localized.length > 0 && normalized === localized;
}
