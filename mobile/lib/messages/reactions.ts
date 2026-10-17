// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The six whole-message reactions, in the order the web app shows them:
 * 👍 ❤️ 😂 😮 😢 🙏. One list, used by the quick row under a tapped bubble and by the
 * long-press sheet, so the two can never drift apart.
 */
export const REACTION_EMOJIS: readonly string[] = [
  '\u{1F44D}',
  '❤️',
  '\u{1F602}',
  '\u{1F62E}',
  '\u{1F622}',
  '\u{1F64F}',
];

/** The server will refuse an edit this long after a message was sent (EDIT_EXPIRED). */
export const MESSAGE_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
