// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The words a reader actually sees in a community FAQ answer.
 *
 * Answers are written by the community's admins (Admin → Help FAQs) and may be
 * HTML. The Help Centre shows them through `SafeHtml`, so searching the raw
 * string matched the markup: "strong", "href" or "class" found answers whose
 * visible text contains none of those words.
 *
 * This mirrors `SafeHtml` exactly: plain text is shown as-is, so it is searched
 * as-is; HTML is sanitised the same way, then read as text. The sanitised
 * markup is parsed with DOMParser, which builds an inert document — no script
 * runs and nothing loads — and nothing is ever written into the live page.
 */

import { containsHtml } from '@/components/ui/SafeHtml';
import { sanitizeMemberRichText } from '@/lib/sanitize';

/**
 * Tags that start or end a visible line; a space beside them stops words in
 * neighbouring paragraphs or list items running together.
 */
const LINE_BREAKS = /<\/?(?:p|div|li|h[1-6]|tr|td|th|blockquote|ul|ol|pre|br)\b[^>]*>/gi;

export function faqAnswerText(answer: string | null | undefined): string {
  if (!answer) return '';
  if (!containsHtml(answer)) return answer;
  const spaced = sanitizeMemberRichText(answer).replace(LINE_BREAKS, (tag) => ` ${tag} `);
  const doc = new DOMParser().parseFromString(spaced, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}
