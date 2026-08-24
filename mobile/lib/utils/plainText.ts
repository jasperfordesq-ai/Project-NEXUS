// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Turn stored rich text into something a React Native `<Text>` can show.
 *
 * 🔴 Reported by a member on 2026-08-24, with a screenshot: a post opened in the app and
 * began
 *
 *     <p class="mb-1 leading-relaxed text-[var(--text-primary)]"><span>So I had meeting
 *     booked in this morning for 10am to chat with a Time Bank mem…
 *
 * Her words: "Writing also garbled". Posts written on the website are stored as HTML — the
 * web composer emits paragraphs, spans and Tailwind classes — and the feed rendered that
 * markup literally, because `<Text>` shows whatever string it is given.
 *
 * 🔴 The app already knew how to do this. Six screens carry their own private copy of a
 * `stripHtml` — blog-post, edit-exchange, event-detail, exchange-detail, group-detail,
 * ideation-detail — plus one inside the comment sheet. The feed, which is the first screen
 * a member sees, had none. This is that helper, once, in a place anything can import.
 *
 * It is deliberately NOT a renderer: the app has no HTML renderer and adding one is a
 * bigger decision. It preserves the structure a reader actually notices — paragraph and
 * line breaks, list items — and drops the rest.
 */

/** Entities the platform's stored content actually contains. */
const ENTITIES: Array<[RegExp, string]> = [
  [/&nbsp;/gi, ' '],
  [/&amp;/gi, '&'],
  [/&lt;/gi, '<'],
  [/&gt;/gi, '>'],
  [/&quot;/gi, '"'],
  [/&#0?39;/gi, "'"],
  [/&apos;/gi, "'"],
  [/&hellip;/gi, '…'],
  [/&mdash;/gi, '—'],
  [/&ndash;/gi, '–'],
  [/&rsquo;/gi, '’'],
  [/&lsquo;/gi, '‘'],
  [/&ldquo;/gi, '“'],
  [/&rdquo;/gi, '”'],
];

/**
 * @param value stored content, HTML or plain
 * @returns text for display, with paragraph breaks kept
 */
export function toPlainText(value: string | null | undefined): string {
  if (!value) return '';
  let text = String(value);

  // Anything inside these is markup a reader must never see, not content.
  text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');

  // Structure a reader notices, before the tags go.
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n\n');
  text = text.replace(/<li\b[^>]*>/gi, '• ');

  text = text.replace(/<[^>]+>/g, '');

  for (const [pattern, replacement] of ENTITIES) {
    text = text.replace(pattern, replacement);
  }

  // A numeric entity the composer sometimes emits for punctuation.
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));

  // Tidy the whitespace the tags left behind, without collapsing the paragraphs:
  // trailing spaces, then runs of blank lines down to one blank line.
  text = text.replace(/[ \t]+\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

/**
 * True when the value looks like stored HTML rather than something a member typed.
 *
 * Used only for tests and diagnostics — the conversion above is safe to run on plain text,
 * so nothing needs to branch on this at render time.
 */
export function looksLikeHtml(value: string | null | undefined): boolean {
  if (!value) return false;
  return /<\/?[a-z][\s\S]*>/i.test(value);
}
