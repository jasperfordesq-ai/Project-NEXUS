// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { APP_URL } from '@/lib/constants';

/**
 * Build a link to a page on the website for the member's own community.
 *
 * 🔴 The slug is NOT optional in practice. Since 2026-05-08 the web app respects a
 * URL exactly as typed: on the shared host (`app.project-nexus.ie`) a path with no
 * community slug renders the platform landing page, and the destination is lost.
 * Every hand-off this app made before this helper — identity verification,
 * marketplace orders, and the three share links — omitted the slug, so on the
 * shared host each one opened the wrong page. They only ever worked for a
 * community on its own domain, where the domain names the community.
 *
 * A slug-prefixed shared-host URL works everywhere, including for communities
 * that also have their own domain, so that is the only form this produces. If the
 * slug is genuinely unavailable (tenant config not loaded yet) we fall back to a
 * bare path rather than emitting `/undefined/...`; callers should treat that as a
 * degraded case, not a normal one.
 */
export function buildWebUrl(tenantSlug: string | null | undefined, path: string): string {
  const base = APP_URL.replace(/\/+$/, '');
  const normalisedPath = path.startsWith('/') ? path : `/${path}`;
  const slug = (tenantSlug ?? '').trim().replace(/^\/+|\/+$/g, '');
  return slug ? `${base}/${encodeURIComponent(slug)}${normalisedPath}` : `${base}${normalisedPath}`;
}
