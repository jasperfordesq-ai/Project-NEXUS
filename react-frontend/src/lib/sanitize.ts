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
import { isSafeUrl } from './safeHref';

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

/**
 * Member-authored rich text (posts, comments, bios, listing / event / group
 * descriptions) gets no `class` or `id`. F-075 (E-027): with `class` kept, a
 * member could borrow the app's own Tailwind classes (`fixed inset-0 z-50 …`)
 * to draw a full-screen fake "sign in again" panel over the real page, and
 * `id` lets content collide with the app's own element ids.
 */
const MEMBER_RICH_TEXT_ALLOWED_ATTR = RICH_TEXT_ALLOWED_ATTR.filter(
  (attr) => attr !== 'class' && attr !== 'id',
);

const INLINE_ALLOWED_TAGS = [
  'br', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'mark', 'span', 'a',
];

const INLINE_ALLOWED_ATTR = [
  'href', 'title', 'class', 'target', 'rel',
];

/* ───────────────────────── URL scheme guard ───────────────────────── */

const URL_BEARING_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href']);
// The scheme rule itself lives in ./safeHref so plain `href` / `window.open`
// sinks share it (F-298). Accepts http(s), mailto: and relative URLs; rejects
// javascript:, data:, vbscript:, file: and every other scheme.

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

/* ───────────── Member links: a member's own words are never a link ───────────── */

/**
 * F-562 (Cyphere pen test, 4 Oct 2026; retest FAILED 6 Oct — E-092). A member
 * could write `<a href="https://evil.example/login">Click here to re-authenticate</a>`
 * into a listing or event description, a post or a comment and it rendered as
 * a perfectly ordinary platform link — not script, so the sanitiser was content,
 * but a convincing phishing lure in another member's feed.
 *
 * The first fix (4 Oct) kept the author's words clickable and appended the
 * destination host beside them: "Click here to re-authenticate (evil.example)".
 * Cyphere retested and failed it: the words a member chose were still a link.
 * Their bar is the standard one for a stored-HTML-injection finding, and this
 * is the rule that meets it:
 *
 *   In member-authored content, the only clickable text is an address.
 *
 * Every anchor is unwrapped — its words (or image) stay as ordinary content —
 * and is followed by ONE link whose text and `href` are both the destination
 * written out in full, canonical form: scheme, host (punycode for look-alike
 * international names), port, path, query and fragment; user-info stripped, so
 * `https://app.project-nexus.ie@evil.example/` shows as `https://evil.example`.
 * `mailto:` shows the mailbox alone. An anchor whose visible text already is
 * its destination (the post composer's link button on a pasted URL,
 * `example.org/page`) is left exactly as it was. An anchor whose address the
 * scheme guard refused becomes plain words. Relative and same-origin links
 * follow the same rule — a lure needs no third-party host.
 *
 * Administrator rich text (`sanitizeRichText`) is not touched.
 *
 * Runs on the sanitiser's OUTPUT, not inside a DOMPurify hook: a hook sees the
 * anchor before its children are cleaned, so `<script>https://evil.example</script>`
 * inside the label would read as a self-describing link and then vanish.
 */
function disarmMemberLinks(cleanHtml: string): string {
  if (!cleanHtml.includes('<a')) return cleanHtml;
  // No DOM to work with (never the case in the browser or jsdom): fail closed —
  // drop the anchor tags and keep the words, rather than let a labelled link through.
  if (typeof document === 'undefined') return cleanHtml.replace(/<\/?a\b[^>]*>/gi, '');

  // <template> content is inert: nothing loads or runs. The markup is already
  // DOMPurify output, so parsing it again changes nothing.
  const tpl = document.createElement('template');
  tpl.innerHTML = cleanHtml;

  const anchors = Array.from(tpl.content.querySelectorAll('a'));
  if (anchors.length === 0) return cleanHtml;

  let changed = false;
  anchors.forEach((anchor) => {
    const parent = anchor.parentNode;
    if (!parent) return;

    const destination = canonicalDestination(anchor.getAttribute('href') ?? '');
    // textContent omits images and their alt text. Only a text-only anchor can
    // qualify: otherwise a matching URL could keep a phishing image clickable.
    if (destination && anchor.childElementCount === 0 && labelIsDestination(anchor.textContent ?? '', destination)) return;

    // The author's words (or image) stay, as ordinary content outside any link.
    const replacement = document.createDocumentFragment();
    while (anchor.firstChild) replacement.appendChild(anchor.firstChild);

    if (destination) {
      const hasWords = (replacement.textContent ?? '').trim() !== '' || replacement.childNodes.length > 0;
      if (hasWords) replacement.appendChild(document.createTextNode(' '));
      const link = document.createElement('a');
      link.setAttribute('href', destination);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer nofollow');
      link.textContent = destination.replace(/^mailto:/, '');
      replacement.appendChild(link);
    }

    parent.replaceChild(replacement, anchor);
    changed = true;
  });

  return changed ? tpl.innerHTML : cleanHtml;
}

/**
 * The destination a reader is shown and sent to, in one canonical spelling —
 * or '' when the address is unusable (empty, refused by the scheme guard, or
 * unparseable).
 */
function canonicalDestination(href: string): string {
  const raw = href.trim();
  if (!raw) return '';

  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return '';
  }

  if (url.protocol === 'mailto:') {
    const mailbox = (url.pathname.split('?')[0] ?? '').trim();
    return mailbox ? `mailto:${mailbox}` : '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';

  // A relative address is shown as the member wrote it: "/listings/1".
  const isRelative = !/^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.startsWith('//');
  if (isRelative) return raw;

  const path = `${url.pathname}${url.search}${url.hash}`;
  return `${url.protocol}//${url.host}${path === '/' ? '' : path}`;
}

/** True when the visible text already is the destination, so the anchor can stay. */
function labelIsDestination(label: string, destination: string): boolean {
  const norm = (value: string) => value.trim().toLowerCase().replace(/\/+$/, '');
  const shown = norm(label);
  if (!shown) return false;
  const target = norm(destination);
  return (
    shown === target
    || shown === target.replace(/^https?:\/\//, '')
    || shown === target.replace(/^mailto:/, '')
  );
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
 * Sanitize MEMBER-authored rich HTML: the rich-text profile without `class`
 * or `id` (see MEMBER_RICH_TEXT_ALLOWED_ATTR). Use for anything a member
 * wrote — feed posts, comments, bios, listing / event / group descriptions.
 * A member's own words are never a link: every anchor is unwrapped and
 * followed by one link that is its own address (F-562, E-092).
 * Administrator-authored content (blog, KB, legal, custom pages) keeps
 * `sanitizeRichText`.
 */
export function sanitizeMemberRichText(html: string | null | undefined): string {
  if (!html) return '';
  installHooksOnce();
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: RICH_TEXT_ALLOWED_TAGS,
    ALLOWED_ATTR: MEMBER_RICH_TEXT_ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    KEEP_CONTENT: true,
  });
  return disarmMemberLinks(clean);
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
