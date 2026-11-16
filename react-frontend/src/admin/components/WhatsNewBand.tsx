// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "What's new" for admins: one slim line at the top of the admin panel when a
 * new version of the platform has been released, with a link to the Changelog
 * page. It appears once per release and stays until it is closed.
 *
 * Where the version comes from: `/changelog-data/index.json`, the file
 * `scripts/copy-changelog.mjs` writes at build time and the public Changelog
 * page reads. The newest entry that is not "Unreleased" is the release. A
 * routine deployment does not change it, so this is not shown after every
 * deployment, only after a release is cut.
 *
 * It shows only while the release is new: its `date` (YYYY-MM-DD) is within
 * the last 30 days. A release with no date, or a date that cannot be read,
 * shows nothing, so an admin who never closed the line is not told months
 * later that an old version "is live". Following "See what changed" also
 * closes it.
 *
 * It shows nothing, and says nothing, when the file is missing, is not the
 * changelog (a server without the `/changelog-data/` rule answers with the
 * app's own HTML), or lists no release. An admin loses nothing by not seeing
 * it: the Changelog page is always there.
 *
 * What has been closed is remembered in this browser only (localStorage). No
 * record of who has seen a release is kept on the server. A browser that will
 * not store anything simply shows the line again next time.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Sparkles from 'lucide-react/icons/sparkles';
import X from 'lucide-react/icons/x';
import { useTenant } from '@/contexts';

export const WHATS_NEW_SEEN_KEY = 'nexus:admin:whats_new_seen';

const CHANGELOG_INDEX = '/changelog-data/index.json';

export interface NewestRelease {
  version: string;
  slug: string;
  /** YYYY-MM-DD as written in the changelog, or null when it has none. */
  date: string | null;
}

/** How long after its date a release is still "new". */
export const WHATS_NEW_DAYS = 30;

/** The newest released version in a changelog index, or null when there is none to name. */
export function newestRelease(index: unknown): NewestRelease | null {
  if (typeof index !== 'object' || index === null) return null;
  const releases = (index as { releases?: unknown }).releases;
  if (!Array.isArray(releases)) return null;

  for (const entry of releases as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { version, slug, date, isUnreleased } = entry as {
      version?: unknown;
      slug?: unknown;
      date?: unknown;
      isUnreleased?: unknown;
    };
    if (isUnreleased === true) continue;
    if (typeof version !== 'string' || typeof slug !== 'string') return null;
    if (version.trim() === '' || slug.trim() === '') return null;
    return {
      version: version.trim(),
      slug: slug.trim(),
      date: typeof date === 'string' && date.trim() !== '' ? date.trim() : null,
    };
  }

  return null;
}

/** True when the release's date reads as a calendar day within the last WHATS_NEW_DAYS days. */
export function isRecentRelease(release: NewestRelease, now: Date = new Date()): boolean {
  const match = release.date === null ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(release.date);
  if (match === null) return false;
  const [, y, m, d] = match;
  const day = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(day.getTime()) || day.getMonth() !== Number(m) - 1) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ageDays = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  // A day ahead is allowed for a release cut in another time zone.
  return ageDays >= -1 && ageDays <= WHATS_NEW_DAYS;
}

function seenRelease(): string | null {
  try {
    return window.localStorage.getItem(WHATS_NEW_SEEN_KEY);
  } catch {
    return null;
  }
}

function rememberRelease(slug: string): void {
  try {
    window.localStorage.setItem(WHATS_NEW_SEEN_KEY, slug);
  } catch {
    // Storage is blocked: the line will show again next time. Nothing to do.
  }
}

export function WhatsNewBand() {
  const { t } = useTranslation('admin_nav');
  const { tenantPath } = useTenant();
  const [release, setRelease] = useState<NewestRelease | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(CHANGELOG_INDEX, { headers: { Accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : null))
      .then((index: unknown) => {
        if (cancelled) return;
        const newest = newestRelease(index);
        if (newest !== null && isRecentRelease(newest) && seenRelease() !== newest.slug) setRelease(newest);
      })
      .catch(() => {
        // No changelog to read: show nothing. This is not an error an admin can act on.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const close = useCallback(() => {
    if (release !== null) rememberRelease(release.slug);
    setRelease(null);
  }, [release]);

  if (release === null) return null;

  return (
    <section
      aria-label={t('whats_new.region_label')}
      data-testid="whats-new-band"
      className="mb-4 flex items-start gap-3 rounded-xl border border-divider bg-surface-secondary px-4 py-3 text-sm text-foreground"
    >
      <Sparkles size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 break-words">
        <span>{t('whats_new.message', { version: release.version })}</span>{' '}
        <Link to={tenantPath('/changelog')} onClick={close} className="font-medium underline underline-offset-2">
          {t('whats_new.link')}
        </Link>
      </p>
      <button
        type="button"
        onClick={close}
        aria-label={t('whats_new.close')}
        className="-m-1 shrink-0 rounded-lg p-1 hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-current dark:hover:bg-white/10"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </section>
  );
}

export default WhatsNewBand;
