// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The community on the member's phone (warmth phase 6, A4): the head tags a
 * browser reads when a page is added to the home screen, or shows in a tab.
 *
 * - `apple-mobile-web-app-title` / `application-name`: the community's name.
 * - `<link rel="icon">`: the community's stored favicon, when it has a safe one.
 * - `<link rel="apple-touch-icon">`: the community's square app icon, when set.
 *
 * Everything else stays as index.html ships it. The theme colour is NOT touched
 * here: ThemeContext already gives the browser bar the community's colour.
 * `applyCommunityHead(null)` puts every tag back exactly as it was.
 *
 * Each tag remembers its shipped value in a `data-shell-*` attribute the first
 * time it is changed, so restoring never depends on when this first ran.
 *
 * The values become addresses the browser fetches, so only an uploaded file
 * (or an https image) is ever used — see safeCommunityIconUrl.
 */

export interface CommunityHead {
  name: string | null | undefined;
  favicon: unknown;
  /** A square app icon. Only ever an uploaded file. */
  appIcon?: unknown;
}

// Raster image types only: an uploaded SVG is a document, not a picture.
const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|ico)$/i;
const UPLOAD_PATH = /^\/uploads\/[A-Za-z0-9._/-]+$/;
/** Marks a tag this module added, so restoring removes it again. */
const CREATED_MARK = 'data-community-head';

function safeUploadPath(path: string): string | null {
  if (!UPLOAD_PATH.test(path) || path.includes('..') || path.includes('//')) return null;
  return IMAGE_EXTENSION.test(path) ? path : null;
}

/** The community's app icon when it is one of our uploaded raster files, else null. */
export function safeAppIconPath(raw: unknown): string | null {
  return typeof raw === 'string' ? safeUploadPath(raw.trim()) : null;
}

/**
 * An icon address that is safe to hand the browser, or null.
 *
 * An uploaded file comes back as a same-site path (`/uploads/...`): the
 * frontend host serves uploads itself, so the icon is fetched from the page's
 * own origin whatever host the API wrote into the address. Any other address
 * must be an https image with no credentials in it.
 */
export function safeCommunityIconUrl(raw: unknown, origin: string = window.location.origin): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value === '' || value.length > 2048) return null;

  if (value.startsWith('//')) return null;
  if (value.startsWith('/')) return safeUploadPath(value);

  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;

  const uploaded = safeUploadPath(url.pathname);
  if (uploaded && !url.search && !url.hash) return uploaded;

  if (url.protocol !== 'https:') return null;
  if (!IMAGE_EXTENSION.test(url.pathname)) return null;
  return url.href;
}

/**
 * Set `attr` on `el` to `value`, or back to the value the page shipped with
 * when `value` is null. An attribute the page shipped without is removed.
 */
function setOrRestore(el: Element | null, attr: string, value: string | null): void {
  if (!el) return;
  const shellKey = `data-shell-${attr}`;
  if (!el.hasAttribute(shellKey)) {
    // '' stands for "not present": none of these attributes is ever empty.
    el.setAttribute(shellKey, el.getAttribute(attr) ?? '');
  }
  const next = value ?? el.getAttribute(shellKey) ?? '';
  if (next === '') el.removeAttribute(attr);
  else el.setAttribute(attr, next);
}

/** A meta tag: shipped ones are changed and restored; missing ones are added and removed. */
function setMeta(doc: Document, name: string, content: string | null): void {
  let meta = doc.querySelector(`meta[name="${name}"]`);
  if (!meta) {
    if (content === null) return;
    meta = doc.createElement('meta');
    meta.setAttribute('name', name);
    meta.setAttribute(CREATED_MARK, '');
    doc.head.appendChild(meta);
  }
  if (meta.hasAttribute(CREATED_MARK)) {
    if (content === null) meta.remove();
    else meta.setAttribute('content', content);
    return;
  }
  setOrRestore(meta, 'content', content);
}

/** Show the community's identity in the head, or (null) restore the shell's. */
export function applyCommunityHead(head: CommunityHead | null, doc: Document = document): void {
  const trimmed = typeof head?.name === 'string' ? head.name.trim() : '';
  const name = trimmed !== '' ? trimmed : null;
  setMeta(doc, 'apple-mobile-web-app-title', name);
  setMeta(doc, 'application-name', name);

  const origin = doc.defaultView?.location?.origin ?? window.location.origin;
  const favicon = head ? safeCommunityIconUrl(head.favicon, origin) : null;
  const icon = doc.querySelector('link[rel="icon"]');
  setOrRestore(icon, 'href', favicon);
  // The shipped icon is an SVG; a community's file is a raster image whose
  // type the browser works out for itself.
  if (favicon) {
    setOrRestore(icon, 'type', null);
    icon?.removeAttribute('type');
  } else {
    setOrRestore(icon, 'type', null);
  }

  // The app icon is only ever an upload of our own (Make it yours), so an
  // address that is not an uploaded file is ignored.
  const appIcon = head ? safeAppIconPath(head.appIcon) : null;
  setOrRestore(doc.querySelector('link[rel="apple-touch-icon"]'), 'href', appIcon);
}
