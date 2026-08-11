// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Turn a sanitised legal document's HTML into ordered blocks the app can render.
 *
 * 🔴 Why not the `stripHtml` helper this app already has four copies of. That one
 * flattens everything into one string: headings vanish into the surrounding
 * paragraph, list items run together, and HTML entities are left as `&amp;`. For a
 * blog excerpt that is fine. For a document a member is being asked to AGREE TO it
 * is not — the structure is how a long policy stays readable, and consent given to
 * an unreadable wall of text is not meaningfully informed.
 *
 * The input is already sanitised by the server (`HtmlSanitizer::sanitizeCms`), so
 * this is a presentation concern, not a security boundary. It deliberately handles
 * only the elements that survive that sanitiser and matter to reading: headings,
 * paragraphs and list items.
 */

export type LegalBlockType = 'heading' | 'paragraph' | 'listItem';

export interface LegalBlock {
  type: LegalBlockType;
  text: string;
  /** 2 or 3 for headings; undefined otherwise. */
  level?: 2 | 3;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

/** Decode the entities a CMS actually produces, plus numeric ones. */
export function decodeEntities(value: string): string {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[String(name).toLowerCase()] ?? match);
}

function textOf(html: string): string {
  return decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseLegalContent(html: string | null | undefined): LegalBlock[] {
  const source = String(html ?? '');
  if (source.trim() === '') return [];

  const blocks: LegalBlock[] = [];
  const pattern = /<(h[1-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const tag = match[1].toLowerCase();
    const text = textOf(match[2]);
    if (text === '') continue;

    if (tag.startsWith('h')) {
      // h1 is treated as h2: the screen already has its own title, and a document
      // that opens with an h1 must not out-rank it.
      blocks.push({ type: 'heading', text, level: tag === 'h3' ? 3 : 2 });
    } else if (tag === 'li') {
      blocks.push({ type: 'listItem', text });
    } else {
      blocks.push({ type: 'paragraph', text });
    }
  }

  // A document with no recognised block elements — plain text, or markup this does
  // not model — still has to be readable rather than blank.
  if (blocks.length === 0) {
    const fallback = textOf(source);
    if (fallback !== '') {
      blocks.push({ type: 'paragraph', text: fallback });
    }
  }

  return blocks;
}

/** The date part of an ISO timestamp, for display. */
export function legalDateOnly(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (raw === '') return '';
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return match ? match[1] : raw.split('T')[0];
}

/**
 * Is this version not yet in force?
 *
 * 🔴 `effective_date` is routinely FUTURE-dated — a policy published now to take
 * effect next month. Saying "Last updated" about it claims terms apply that do
 * not. Compared date-only, so a document effective today counts as in force
 * everywhere.
 */
export function isNotYetInForce(value: string | null | undefined, now: Date = new Date()): boolean {
  const day = legalDateOnly(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return day > now.toISOString().slice(0, 10);
}
