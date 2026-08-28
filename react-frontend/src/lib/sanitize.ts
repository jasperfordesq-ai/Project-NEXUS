// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * sanitize.ts — Unified DOMPurify configuration for the React frontend.
 *
 * All `dangerouslySetInnerHTML` usages in the app should sanitize through
 * one of the two helpers exported here. This guarantees a single, audited
 * allow-list of tags / attributes / URI schemes across every surface
 * (blog posts, KB articles, custom pages, legal docs, profile bios, feed
 * content, admin panels, etc.).
 *
 * Two profiles:
 *   - sanitizeRichText(html): block-level rich content (articles, posts,
 *     legal docs, blog) — paragraphs, headings, lists, blockquotes,
 *     tables, images, links.
 *   - sanitizeInline(html):  short inline strings (translation strings,
 *     descriptions, badges) — only emphasis tags + safe links.
 *
 * URL safety:
 *   DOMPurify's built-in URI scheme allow-list is replaced via the
 *   `uponSanitizeAttribute` hook. Only `http:`, `https:`, and `mailto:`
 *   are accepted on URL-bearing attributes. `javascript:`, `data:`,
 *   `vbscript:`, `file:`, and any other scheme is stripped.
 *
 *   Anchor tags are additionally normalised to carry
 *   `target="_blank"` + `rel="noopener noreferrer nofollow"` so user-
 *   submitted links cannot tabnab the parent window or pass referrer
 *   data to third parties.
 */

import DOMPurify from 'dompurify';
import {
  PAGE_BUILDER_ALLOWED_ATTR,
  PAGE_BUILDER_ALLOWED_TAGS,
  sanitizePageBuilderInlineStyle,
  scopePageBuilderHtml,
} from './pageBuilderHtml';

/* ───────────────────────── Allow-lists ───────────────────────── */

const RICH_TEXT_ALLOWED_TAGS = [
  // Block-level
  'p', 'br', 'hr', 'div', 'span',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'code',
  // Lists
  'ul', 'ol', 'li',
  // Inline emphasis
  'strong', 'em', 'b', 'i', 'u', 's', 'sub', 'sup', 'mark', 'small',
  // Links + media
  'a', 'img', 'figure', 'figcaption',
  // Tables
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  // Diff rendering (used by legal version comparison)
  'ins', 'del',
];

const RICH_TEXT_ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'class', 'id',
  'colspan', 'rowspan', 'scope',
  'width', 'height', 'loading',
  'target', 'rel',
];

const INLINE_ALLOWED_TAGS = [
  'br', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'mark', 'span', 'a',
];

const INLINE_ALLOWED_ATTR = [
  'href', 'title', 'class', 'target', 'rel',
];

/* ───────────────────────── URL scheme guard ───────────────────────── */

const URL_BEARING_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href']);
const SAFE_URL_REGEX = /^(?:(?:https?|mailto):|[#/?]|[a-z0-9._~%!$&'()*+,;=@-]+(?:[/?#]|$))/i;
const RELATIVE_OR_FRAGMENT_REGEX = /^(?:[#/?]|\.{1,2}\/|[a-z0-9._~%!$&'()*+,;=@-]+\/)/i;

/**
 * Is `value` a URL we'll accept on an href/src/action-style attribute?
 *
 * Accepts:
 *   - Absolute http(s) URLs
 *   - mailto:
 *   - Relative paths and fragment identifiers
 *
 * Rejects:
 *   - javascript:, data:, vbscript:, file:, ftp:, anything else
 *   - URLs with embedded null bytes / whitespace tricks
 */
function isSafeUrl(value: string): boolean {
  // Strip control characters and whitespace that browsers ignore but parsers may not
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\x00-\x20]+/g, '').trim();
  if (cleaned === '') return false;

  // Fast path: relative URL or fragment
  if (RELATIVE_OR_FRAGMENT_REGEX.test(cleaned)) return true;

  // Has a scheme — must be http(s) or mailto
  const schemeMatch = cleaned.match(/^([a-z][a-z0-9+.-]*):/i);
  if (schemeMatch && schemeMatch[1]) {
    const scheme = schemeMatch[1].toLowerCase();
    return scheme === 'http' || scheme === 'https' || scheme === 'mailto';
  }

  // No scheme detected: treat as relative
  return SAFE_URL_REGEX.test(cleaned);
}

/* ───────────────────────── Hook installation ───────────────────────── */

let hooksInstalled = false;

function installHooksOnce(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;

  // Per-attribute scheme check — runs after DOMPurify's own checks.
  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    const attrName = data.attrName?.toLowerCase() ?? '';
    if (attrName === 'style') {
      const safeStyle = sanitizePageBuilderInlineStyle(String(data.attrValue ?? ''));
      if (!safeStyle) {
        data.keepAttr = false;
        data.attrValue = '';
      } else {
        data.attrValue = safeStyle;
      }
      return;
    }

    if (!URL_BEARING_ATTRS.has(attrName)) return;

    const value = String(data.attrValue ?? '');
    if (!isSafeUrl(value)) {
      data.keepAttr = false;
      data.attrValue = '';
    }
  });

  // Force safe link attributes on every anchor.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return;
    if (node.tagName === 'A') {
      // External-by-default. If this becomes a problem for in-app SPA links
      // we can refine later — for now safety > UX.
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
    if (node.tagName === 'IMG') {
      // Lazy-load + decoupled error path keep render cheap and safe.
      if (!node.hasAttribute('loading')) node.setAttribute('loading', 'lazy');
      node.setAttribute('referrerpolicy', 'no-referrer');
    }
  });
}

/* ───────────────────────── Public API ───────────────────────── */

/**
 * Sanitize a block of rich HTML for rendering via dangerouslySetInnerHTML.
 *
 * Use for: blog posts, KB articles, legal documents, custom pages,
 * profile bios, feed post bodies, version diffs.
 */
export function sanitizeRichText(html: string | null | undefined): string {
  if (!html) return '';
  installHooksOnce();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: RICH_TEXT_ALLOWED_TAGS,
    ALLOWED_ATTR: RICH_TEXT_ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    KEEP_CONTENT: true,
  });
}

/**
 * Sanitize admin-authored custom page builder HTML.
 *
 * This is intentionally broader than rich text so GrapesJS pages keep their
 * exported CSS, semantic sections, and basic form markup. Scripts and unsafe
 * URL schemes are still stripped by DOMPurify and the shared URL hook.
 */
export function sanitizeCustomPageHtml(html: string | null | undefined): string {
  if (!html) return '';
  installHooksOnce();
  const scoped = scopePageBuilderHtml(html);

  // Separate the scoped CSS from the body BEFORE the body's sanitize pass, NOT after.
  //
  // DOMPurify removes <style> elements even when ALLOWED_TAGS explicitly lists them — verified in
  // Chrome against dompurify 3.4.2, not merely in jsdom. This function used to hand the whole
  // scoped document to DOMPurify and then look for <style> in the result, so the style element was
  // always already gone: every custom builder page lost its entire stylesheet (the baseline rules,
  // the page's own scoped rules, and the theme overrides) and rendered unstyled in production.
  //
  // CSS safety is not DOMPurify's job here and never was. scopePageBuilderCss is the policy: it
  // prefixes every selector with the container class, drops global/app-shell selectors, and strips
  // escape declarations even when they carry !important. Keeping the CSS out of the DOMPurify pass
  // preserves that boundary while letting the body still be sanitized twice.
  const parsed = new DOMParser().parseFromString(scoped, 'text/html');
  const scopedCss = Array.from(parsed.querySelectorAll('style'))
    .map((style) => style.textContent || '')
    .filter(Boolean)
    .join('\n');
  parsed.querySelectorAll('style').forEach((node) => node.remove());

  const fragment = DOMPurify.sanitize(parsed.body.innerHTML, {
    ALLOWED_TAGS: PAGE_BUILDER_ALLOWED_TAGS,
    ALLOWED_ATTR: PAGE_BUILDER_ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    KEEP_CONTENT: true,
    RETURN_DOM_FRAGMENT: true,
  });
  const container = document.createElement('div');
  container.append(fragment);

  return `${scopedCss ? `<style>${scopedCss}</style>` : ''}${container.innerHTML}`;
}

/**
 * Sanitize a short inline HTML snippet (typically a translated string with
 * `<strong>` or a link inside).
 *
 * Use for: i18n strings rendered with HTML, badge/chip labels, descriptions.
 */
export function sanitizeInline(html: string | null | undefined): string {
  if (!html) return '';
  installHooksOnce();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: INLINE_ALLOWED_TAGS,
    ALLOWED_ATTR: INLINE_ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    KEEP_CONTENT: true,
  });
}

/**
 * Strip all HTML tags and return plain text.
 * Use for truncated bio/description snippets that should never render HTML.
 */
export function stripHtmlToText(html: string | null | undefined): string {
  if (!html) return '';
  installHooksOnce();
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: [], KEEP_CONTENT: true });
}

/**
 * Turn stored rich text into readable plain text, keeping the breaks a reader notices.
 *
 * `stripHtmlToText` concatenates the text nodes, so `<p>One</p><p>Two</p>` comes back as
 * "OneTwo" — right for a one-line bio, wrong for anything quoting a post written in the web
 * composer, where it would run two sentences together. This inserts the paragraph and line
 * breaks first, then strips, then decodes the entities the stripper leaves encoded (`&amp;`
 * would otherwise be shown to the reader exactly like that).
 *
 * Use it wherever stored content must appear as TEXT. Where it should appear as formatting,
 * render it through `sanitizeRichText` instead — see `FeedContentRenderer`.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return '';

  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '• ');

  const stripped = stripHtmlToText(withBreaks);

  // Every tag is gone by this point, so there is nothing left for a parser to execute; the
  // textarea is only being used as the browser's own entity decoder.
  const decoder = document.createElement('textarea');
  decoder.innerHTML = stripped;

  return decoder.value.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Exposed for tests / advanced callers that need to share the URL guard. */
export const __testing = { isSafeUrl };
