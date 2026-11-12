// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SiteAnnouncementBanner — the one-line notice a community's admins post
 * across the top of their member website (warmth phase 5).
 *
 * The notice arrives with the tenant bootstrap (`tenant.announcement`);
 * lib/siteAnnouncement decides whether it may be shown now and makes it safe.
 *
 *  - The words are admin-written plain text, rendered as text.
 *  - A labelled region, not an alert: it is read in the page's order and
 *    never interrupts a screen reader or takes focus.
 *  - Colours are readable by construction: white on the community's button
 *    shade (the same pair the buttons use, in light and dark, soft or vivid),
 *    or the amber warning pair for "important".
 *  - Closing it is remembered on this device until the notice is edited.
 *  - Left out of the snapshots made for search engines (a notice is of the
 *    moment; a snapshot is kept for days).
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Megaphone from 'lucide-react/icons/megaphone';
import PartyPopper from 'lucide-react/icons/party-popper';
import TriangleAlert from 'lucide-react/icons/triangle-alert';
import ExternalLink from 'lucide-react/icons/external-link';
import X from 'lucide-react/icons/x';
import { useTenant } from '@/contexts/TenantContext';
import {
  announcementDismissKey,
  announcementEndsAt,
  currentAnnouncement,
  type AnnouncementStyle,
  type SiteAnnouncement,
} from '@/lib/siteAnnouncement';
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/safeStorage';
import { TranslateButton } from '@/components/i18n/TranslateButton';

const STYLE: Record<AnnouncementStyle, { band: string; quiet: string; words: string; icon: typeof Megaphone }> = {
  info: {
    band: 'bg-accent-strong text-white',
    quiet: 'hover:bg-white/15 focus-visible:outline-white',
    words: 'text-white!',
    icon: Megaphone,
  },
  celebration: {
    band: 'bg-linear-to-r from-accent-strong to-accent-strong-end text-white',
    quiet: 'hover:bg-white/15 focus-visible:outline-white',
    words: 'text-white!',
    icon: PartyPopper,
  },
  important: {
    band: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
    quiet: 'hover:bg-amber-900/10 focus-visible:outline-amber-900 dark:hover:bg-amber-100/10 dark:focus-visible:outline-amber-100',
    words: 'text-amber-900! dark:text-amber-100!',
    icon: TriangleAlert,
  },
};

function isSearchEngineSnapshot(): boolean {
  return typeof window !== 'undefined' && window.location.search.includes('nexus_prerender_bypass');
}

/**
 * The banner itself, for a notice already checked by `currentAnnouncement`.
 * Also used as the live preview on the admin screen, so what an admin sees
 * while writing is the real thing. Without `onDismiss` there is no close button.
 */
export function SiteAnnouncementView({
  announcement,
  onDismiss,
  linkPath,
  translation,
}: {
  announcement: SiteAnnouncement;
  onDismiss?: () => void;
  /** The live banner's Translate button and what it is showing; never on the admin preview. */
  translation?: { button: ReactNode; message: string | null; linkLabel: string | null };
  /** Turns a path inside the site into the community's address. */
  linkPath: (path: string) => string;
}) {
  const { t } = useTranslation('common');
  const style = STYLE[announcement.style];
  const Icon = style.icon;
  const linkClass = `inline-flex min-h-8 items-center gap-1 rounded-md px-1 font-semibold underline underline-offset-2 outline-solid outline-transparent focus-visible:outline-2 focus-visible:outline-offset-2 ${style.quiet}`;

  return (
    <section
      aria-label={t('announcement_region_label')}
      data-testid="site-announcement"
      data-style={announcement.style}
      className={`flex items-center gap-3 px-4 py-2.5 text-sm sm:px-6 ${style.band}`}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 leading-6">
        <span>{translation?.message ?? announcement.message}</span>
        {announcement.linkUrl && announcement.linkLabel && (
          <>
            {' '}
            {announcement.linkIsInternal ? (
              <Link to={linkPath(announcement.linkUrl)} className={linkClass}>
                {translation?.linkLabel ?? announcement.linkLabel}
              </Link>
            ) : (
              <a href={announcement.linkUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
                {translation?.linkLabel ?? announcement.linkLabel}
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            )}
          </>
        )}
      </p>
      {translation?.button}
      {announcement.isDismissible && onDismiss && (
        <button
          type="button"
          aria-label={t('announcement_dismiss')}
          onClick={onDismiss}
          className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full outline-solid outline-transparent focus-visible:outline-2 focus-visible:outline-offset-2 ${style.quiet}`}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

export function SiteAnnouncementBanner() {
  const { tenant, tenantPath } = useTenant();
  const raw = tenant?.announcement;
  // The page stays open for hours, so "now" has to move: without this the
  // notice was checked once and stayed up past its end time until a reload.
  const [now, setNow] = useState(() => Date.now());
  const announcement = useMemo(() => currentAnnouncement(raw, now), [raw, now]);
  const endsAt = announcement ? announcementEndsAt(raw) : null;

  useEffect(() => {
    if (endsAt === null) return undefined;
    // setTimeout cannot wait longer than about 24.8 days; a longer wait just
    // checks again then.
    const wait = Math.min(Math.max(endsAt - Date.now(), 0) + 50, 2_000_000_000);
    const timer = window.setTimeout(() => setNow(Date.now()), wait);
    return () => window.clearTimeout(timer);
  }, [endsAt, now]);
  const dismissKey = announcement ? announcementDismissKey(announcement) : null;
  const [closedKey, setClosedKey] = useState<string | null>(null);
  // What the Translate button is showing, for this version of the notice only.
  const [translated, setTranslated] = useState<{ key: string; message: string | null; linkLabel: string | null } | null>(null);

  if (!announcement || !dismissKey || isSearchEngineSnapshot()) return null;
  if (closedKey === dismissKey || safeLocalStorageGet(dismissKey) !== null) return null;

  return (
    <SiteAnnouncementView
      announcement={announcement}
      linkPath={tenantPath}
      translation={{
        // The shared button decides whether to show (signed in, translation
        // on, words not already in the reader's language).
        button: (
          <TranslateButton
            contentType="site_announcement"
            contentId={announcement.id}
            sourceText={announcement.message}
            extraFields={{ link_label: announcement.linkLabel }}
            onTextChange={(text, isTranslated) => setTranslated((prev) => ({
              key: dismissKey,
              message: isTranslated ? text : null,
              linkLabel: prev?.key === dismissKey ? prev.linkLabel : null,
            }))}
            onFieldsChange={(fields) => setTranslated((prev) => ({
              key: dismissKey,
              message: prev?.key === dismissKey ? prev.message : null,
              linkLabel: fields?.link_label ?? null,
            }))}
            className={`shrink-0 ${STYLE[announcement.style].words} ${STYLE[announcement.style].quiet}`}
          />
        ),
        message: translated?.key === dismissKey ? translated.message : null,
        linkLabel: translated?.key === dismissKey ? translated.linkLabel : null,
      }}
      onDismiss={() => {
        safeLocalStorageSet(dismissKey, new Date().toISOString());
        setClosedKey(dismissKey);
        // The close button is about to go: keep a keyboard user in the page
        // (the main area the banner sits at the top of) rather than letting
        // focus fall back to the start of the document.
        if (typeof document !== 'undefined') document.getElementById('main-content')?.focus();
      }}
    />
  );
}

export default SiteAnnouncementBanner;
