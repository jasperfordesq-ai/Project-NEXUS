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
}

/** The newest released version in a changelog index, or null when there is none to name. */
export function newestRelease(index: unknown): NewestRelease | null {
  if (typeof index !== 'object' || index === null) return null;
  const releases = (index as { releases?: unknown }).releases;
  if (!Array.isArray(releases)) return null;

  for (const entry of releases as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { version, slug, isUnreleased } = entry as { version?: unknown; slug?: unknown; isUnreleased?: unknown };
    if (isUnreleased === true) continue;
    if (typeof version !== 'string' || typeof slug !== 'string') return null;
    if (version.trim() === '' || slug.trim() === '') return null;
    return { version: version.trim(), slug: slug.trim() };
  }

  return null;
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
        if (newest !== null && seenRelease() !== newest.slug) setRelease(newest);
      })
      .catch(() => {
        // No changelog to read: show nothing. This is not an error an admin can act on.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const close = useCallback(() => {
    setRelease((current) => {
      if (current !== null) rememberRelease(current.slug);
      return null;
    });
  }, []);

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
        <Link to={tenantPath('/changelog')} className="font-medium underline underline-offset-2">
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
