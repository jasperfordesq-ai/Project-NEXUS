// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * safeHref.ts — the one URL-scheme guard for link sinks.
 *
 * F-298 (E-062): the only scheme allow-list in the React app used to be private
 * to the HTML sanitiser (`sanitize.ts`), so it protected sanitised HTML and
 * nothing else. Every `href={…}` / `window.open(…)` that renders a URL a member
 * or an administrator typed (an interview meeting link, a safeguarding evidence
 * link, an order's tracking link, a venue or organisation website…) took the
 * server string raw.
 *
 * `sanitize.ts` now imports `isSafeUrl` from here, so sanitised HTML and plain
 * link sinks share exactly one rule.
 *
 * Accepts: absolute http(s), mailto:, and relative paths / fragments.
 * Rejects: javascript:, data:, vbscript:, file:, blob:, intent:, any other
 * scheme, and whitespace/control-character tricks such as "java\tscript:".
 *
 * React 19 already refuses to navigate to a `javascript:` href, so this is not
 * the last line against script execution; it also stops data:, file: and
 * app-scheme links, and gives non-React consumers of these helpers the same rule.
 */

const SAFE_URL_REGEX = /^(?:(?:https?|mailto):|[#/?]|[a-z0-9._~%!$&'()*+,;=@-]+(?:[/?#]|$))/i;
const RELATIVE_OR_FRAGMENT_REGEX = /^(?:[#/?]|\.{1,2}\/|[a-z0-9._~%!$&'()*+,;=@-]+\/)/i;

/**
 * Is `value` a URL we'll accept on an href/src/action-style attribute?
 */
export function isSafeUrl(value: string): boolean {
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

/**
 * The value to put in an `href`, or `undefined` when it must not be a link.
 * An `<a>` / `<Button as="a">` with no href is inert, so a refused value can
 * never navigate anywhere.
 */
export function safeHref(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed !== '' && isSafeUrl(trimmed) ? trimmed : undefined;
}

/**
 * Like safeHref, but only an absolute http(s) URL counts. For free-text fields
 * that are sometimes a link and sometimes prose ("Room 3, second floor"), so
 * prose is never turned into an in-app relative link.
 */
export function webHref(value: string | null | undefined): string | undefined {
  const href = safeHref(value);
  return href && /^https?:\/\//i.test(href) ? href : undefined;
}

/**
 * `window.open` for a URL that came from data. Does nothing for a refused
 * value, and always opens with `noopener,noreferrer`.
 */
export function openSafeUrl(value: string | null | undefined): void {
  const href = safeHref(value);
  if (href && typeof window !== 'undefined') {
    window.open(href, '_blank', 'noopener,noreferrer');
  }
}
