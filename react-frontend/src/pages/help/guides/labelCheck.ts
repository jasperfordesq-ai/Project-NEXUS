// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The rules of the Help Centre label check (`guides.labels.test.ts`).
 *
 * The guides put on-screen labels in **bold** ("press **Save Changes**"). A
 * label is only right if the app really shows those words, in that language.
 * The check looks up every bold span of every guide article in the same
 * locale's ordinary UI translation files (every namespace except `help_*`) and
 * reports the ones that are not there.
 *
 * Matching rules, deliberately simple so a translator can predict them:
 *
 *   - Whitespace is collapsed and both ends trimmed.
 *   - A trailing colon or ellipsis (":", "：", "…", "...") is ignored on both
 *     sides, so **Language** matches a "Language:" label and vice versa.
 *   - Otherwise the match is exact, including capitals: "Save changes" is not
 *     "Save Changes", and a reader looking for one will not see the other.
 *   - A UI text with placeholders ("{{count}} left today") matches a label
 *     with any value in their place ("5 left today"), provided the text has at
 *     least two letters of its own, so "{{name}}" alone matches nothing.
 *   - A bold span ending in a full stop ("**Do not delete anything.**") is a
 *     sentence bolded for emphasis, not a label, and is not checked. On-screen
 *     button and menu labels do not end in a full stop.
 *   - A bold span that is the title of a guide section or article in the same
 *     language is a cross-reference to that guide and passes.
 *
 * What a pass does NOT prove: that the label is on the page the article
 * describes, or that the sentence around it is accurate. It proves only that
 * the words exist somewhere in that language's interface.
 *
 * Pure functions only — the test reads the files.
 */

export const BOLD_PATTERN = /\*\*([^*]+)\*\*/g;

/** Every bold span in an article body, as written. */
export function boldSpans(body: string): string[] {
  return [...body.matchAll(BOLD_PATTERN)].map((match) => match[1] ?? '');
}

const TRAILING = /(?:\s*(?::|：|…|\.\.\.))+$/u;

/** The form both sides are compared in. */
export function normalizeLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(TRAILING, '').trim();
}

/** A bolded sentence, not a label: ends with a full stop (after normalising). */
export function isEmphasisSentence(label: string): boolean {
  return /[.。]$/u.test(normalizeLabel(label));
}

/** Every string value in a translation file, however deeply nested. */
export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) collectStrings(child, out);
  }
  return out;
}

const PLACEHOLDER = /\{\{[^}]+\}\}/g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface UiText {
  /** Whether `label` (as written in a guide) appears in the interface text. */
  has: (label: string) => boolean;
}

/** An index of a locale's interface text, built once and queried per label. */
export function buildUiText(values: string[]): UiText {
  const exact = new Set<string>();
  const templates: RegExp[] = [];
  for (const raw of values) {
    const value = normalizeLabel(raw);
    if (!value) continue;
    exact.add(value);
    if (value.includes('{{')) {
      const literal = value.replace(PLACEHOLDER, '');
      if (!/\p{L}{2,}/u.test(literal)) continue;
      const pattern = value.split(PLACEHOLDER).map(escapeRegExp).join('.+?');
      templates.push(new RegExp(`^${pattern}$`, 'u'));
    }
  }
  return {
    has(label: string) {
      const wanted = normalizeLabel(label);
      if (exact.has(wanted)) return true;
      return templates.some((template) => template.test(wanted));
    },
  };
}

export interface AllowlistEntry {
  label: string;
  /** Locales the exception applies to, or "*" for all of them. */
  locales: string[] | '*';
  reason: string;
}

export function isAllowlisted(entry: AllowlistEntry, locale: string, label: string): boolean {
  return normalizeLabel(entry.label) === normalizeLabel(label)
    && (entry.locales === '*' || entry.locales.includes(locale));
}

/** "<audience>/<section>/<article>: <label>" — one baseline or report line. */
export function failureKey(audience: string, sectionId: string, articleId: string, label: string): string {
  return `${audience}/${sectionId}/${articleId}: ${normalizeLabel(label)}`;
}
