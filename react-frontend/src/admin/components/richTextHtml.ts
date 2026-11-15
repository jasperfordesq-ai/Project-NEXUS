// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Pure helpers for RichTextEditor's HTML view.
 *
 * The visual editor (Lexical) holds paragraphs, headings, lists, quotes, links
 * and inline formatting. Anything else is dropped when HTML is loaded into it.
 * These helpers say when that would happen, and make the editor's one-line
 * output readable in the HTML view.
 */

/**
 * Markup the content sanitiser allows but the visual editor has no node for.
 * Loading it into the visual editor removes it.
 */
const TAGS_THE_VISUAL_EDITOR_DROPS = /<(?:img|table|hr|figure|pre)\b/i;

/** Would loading this HTML into the visual editor lose something? */
export function needsHtmlView(html: string): boolean {
  return TAGS_THE_VISUAL_EDITOR_DROPS.test(html);
}

const BLOCK_CLOSE = /(<\/(?:p|h[1-6]|ul|ol|li|blockquote|table|thead|tbody|tr|div|figure|pre)>)(?=<)/gi;
const LIST_OPEN = /(<(?:ul|ol)\b[^>]*>)(?=<)/gi;

/**
 * Put each block on its own line. The visual editor writes its HTML as one long
 * line, which nobody can read or edit. HTML that already has line breaks was
 * written by a person and is left exactly as it is.
 */
export function tidyHtmlForSource(html: string): string {
  if (html.includes('\n')) return html;

  return html.replace(BLOCK_CLOSE, '$1\n').replace(LIST_OPEN, '$1\n');
}
