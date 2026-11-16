// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform-wide notices: a short notice the platform team writes once and
 * every community's admins see as a band at the top of the admin panel.
 *
 * The server checks everything on the way in and again on the way out
 * (App\Services\PlatformTeam\PlatformNoticeService). The two checks here are
 * the browser's own last line: a kind it does not know is plain information,
 * and a link that is not a full https:// address is never drawn.
 */

export const PLATFORM_NOTICE_KINDS = ['info', 'planned_work', 'important'] as const;
export type PlatformNoticeKind = (typeof PLATFORM_NOTICE_KINDS)[number];

/** What an admin is sent: only what the band shows. */
export interface PlatformNotice {
  id: number;
  message: string;
  kind: string;
  link_url: string | null;
  link_label: string | null;
  is_dismissible: boolean;
}

export const PLATFORM_NOTICE_MAX_MESSAGE = 280;
export const PLATFORM_NOTICE_MAX_LINK_LABEL = 60;

export function noticeKind(value: unknown): PlatformNoticeKind {
  return (PLATFORM_NOTICE_KINDS as readonly unknown[]).includes(value) ? (value as PlatformNoticeKind) : 'info';
}

/**
 * The address when it is a full https:// address with a host and no
 * "user@" part, else null. Not a path: "a page on this site" means nothing
 * for a notice shown inside every community.
 */
export function httpsLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (url === '' || url.length > 500) return null;
  // Spaces, control characters and backslashes (browsers read "/\host" as "//host").
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f\\]/.test(url)) return null;
  if (!url.toLowerCase().startsWith('https://')) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname === '' || parsed.username !== '' || parsed.password !== '') {
      return null;
    }
  } catch {
    return null;
  }
  return url;
}
