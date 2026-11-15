// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
'use strict';

const { URL } = require('node:url');

/**
 * The community notice banner (warmth phase 6, E6).
 *
 * A community's admins post one-line notices (Admin → Announcements); the
 * tenant bootstrap carries the one to show now as `announcement`
 * (SiteAnnouncementService::currentForTenant: active, started, not ended — it
 * has no audience rule, so signed-out visitors see it too, as on the React
 * site). This module is the port of react-frontend/src/lib/siteAnnouncement.ts
 * and checks the same three things again here, because the bootstrap is cached
 * (by the API and by lib/api.js) and a copy can outlive the notice:
 *
 *  - the dates: nothing before `starts_at`, nothing from `ends_at`, and a date
 *    that was sent but cannot be read shows nothing;
 *  - the style: only one of our three names reaches the template;
 *  - the link: only a path inside this site or an https:// address becomes a
 *    link (and only with a label). Anything else is shown without one.
 *
 * Dismissal: the React banner can be closed (remembered in the browser until
 * the notice is edited). This banner cannot be closed — a plain GOV.UK
 * notification banner. A no-JavaScript "hide" would need a form post and a
 * cookie on every page; left for a later decision.
 */

const STYLES = ['info', 'celebration', 'important'];

function safeLink(value) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (url === '' || url.length > 500) return null;
  // Control characters, any space, backslashes ("/\host" is read as "//host").
  for (const char of url) {
    const code = char.codePointAt(0) || 0;
    if (code <= 0x1f || code === 0x7f || char === '\\' || /\s/.test(char)) return null;
  }
  if (url.startsWith('/')) {
    return url.startsWith('//') ? null : { url, internal: true };
  }
  if (!/^https:\/\//i.test(url)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname === '' || parsed.username !== '' || parsed.password !== '') {
      return null;
    }
    return { url, internal: false };
  } catch {
    return null;
  }
}

function time(value) {
  if (typeof value !== 'string' || value === '') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function sent(value) {
  return value !== null && value !== undefined && value !== '';
}

/**
 * @param {unknown} raw `tenant.announcement` from the bootstrap
 * @param {{ now?: number, urlFor?: (path: string) => string }} options
 * @returns {{ id: number, message: string, style: string, link: { href: string, label: string, internal: boolean } | null } | null}
 */
function currentSiteAnnouncement(raw, { now = Date.now(), urlFor = (value) => value } = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const id = Number(raw.id);
  const message = typeof raw.message === 'string' ? raw.message.trim() : '';
  if (!Number.isInteger(id) || id <= 0 || message === '') return null;

  const startsAt = time(raw.starts_at);
  const endsAt = time(raw.ends_at);
  if (sent(raw.starts_at) && startsAt === null) return null;
  if (sent(raw.ends_at) && endsAt === null) return null;
  if (startsAt !== null && startsAt > now) return null;
  if (endsAt !== null && endsAt <= now) return null;

  const style = STYLES.includes(String(raw.style)) ? String(raw.style) : 'info';
  const link = safeLink(raw.link_url);
  const label = typeof raw.link_label === 'string' ? raw.link_label.trim() : '';

  return {
    id,
    message,
    style,
    link: link && label !== ''
      ? { href: link.internal ? urlFor(link.url) : link.url, label, internal: link.internal }
      : null
  };
}

module.exports = { currentSiteAnnouncement };
