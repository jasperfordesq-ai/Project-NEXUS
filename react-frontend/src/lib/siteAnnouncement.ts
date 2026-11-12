// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The community announcement banner (warmth phase 5).
 *
 * A community's admins post one-line notices (Admin → Announcements); the
 * tenant bootstrap carries the one to show now as `announcement`
 * (SiteAnnouncementService::currentForTenant). This module turns that raw
 * value into something safe to show, or null.
 *
 * Three things are checked HERE as well as on the server:
 *  - the dates: the bootstrap is cached (the server for ten minutes, the
 *    browser too), so a copy can outlive the notice's end time, or arrive
 *    before its start;
 *  - the style: only one of ours picks the banner's colours;
 *  - the link: only a path inside this site or an https:// address becomes
 *    a link. Anything else is shown without one.
 */

export const ANNOUNCEMENT_STYLES = ['info', 'celebration', 'important'] as const;
export type AnnouncementStyle = (typeof ANNOUNCEMENT_STYLES)[number];

export interface SiteAnnouncement {
  id: number;
  message: string;
  style: AnnouncementStyle;
  /** A path inside the site ("/events/12") or an https:// address; null for no link. */
  linkUrl: string | null;
  linkLabel: string | null;
  /** True when linkUrl is a path inside the site. */
  linkIsInternal: boolean;
  isDismissible: boolean;
  /** Changes whenever the notice is edited, so an edited notice shows again. */
  version: string;
}

/** A path inside the site, or an https:// address with a host and no user name. */
export function safeAnnouncementLink(value: unknown): { url: string; internal: boolean } | null {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (url === '' || url.length > 500) return null;
  // Control characters, any space, backslashes ("/\host" is read as "//host").
  for (const char of url) {
    const code = char.codePointAt(0) ?? 0;
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

function time(value: unknown): number | null {
  if (typeof value !== 'string' || value === '') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * When a notice stops being shown, as a time in milliseconds, or null when it
 * has no end. The banner sets a timer for it: the website stays open, so a
 * notice must go at its end time without waiting for a reload.
 */
export function announcementEndsAt(raw: unknown): number | null {
  if (raw === null || typeof raw !== 'object') return null;
  return time((raw as Record<string, unknown>).ends_at);
}

/** The notice to show at `now`, or null: wrong shape, not started, ended. */
export function currentAnnouncement(raw: unknown, now: number = Date.now()): SiteAnnouncement | null {
  if (raw === null || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;

  const id = Number(value.id);
  const message = typeof value.message === 'string' ? value.message.trim() : '';
  if (!Number.isInteger(id) || id <= 0 || message === '') return null;

  const startsAt = time(value.starts_at);
  const endsAt = time(value.ends_at);
  // A date that was sent but cannot be read is not "no date": show nothing.
  if (value.starts_at != null && value.starts_at !== '' && startsAt === null) return null;
  if (value.ends_at != null && value.ends_at !== '' && endsAt === null) return null;
  if (startsAt !== null && startsAt > now) return null;
  if (endsAt !== null && endsAt <= now) return null;

  const style = (ANNOUNCEMENT_STYLES as readonly string[]).includes(String(value.style))
    ? (value.style as AnnouncementStyle)
    : 'info';
  const link = safeAnnouncementLink(value.link_url);
  const label = typeof value.link_label === 'string' ? value.link_label.trim() : '';

  return {
    id,
    message,
    style,
    linkUrl: link?.url ?? null,
    linkLabel: link && label !== '' ? label : null,
    linkIsInternal: link?.internal ?? false,
    isDismissible: value.is_dismissible !== false,
    version: typeof value.updated_at === 'string' ? value.updated_at : '',
  };
}

/** Where "I have closed this notice" is remembered on this device. */
export function announcementDismissKey(announcement: Pick<SiteAnnouncement, 'id' | 'version'>): string {
  return `nexus_announcement_dismissed:${announcement.id}:${announcement.version}`;
}
