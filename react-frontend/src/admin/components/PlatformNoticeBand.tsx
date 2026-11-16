// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform-wide notices, as an admin sees them: a band at the top of the
 * admin panel and the super admin panel. Written by the platform team in
 * their own panel (`/platform-team/notices`); members and brokers never see
 * one.
 *
 * 🔴 The words are plain text. They are put on the page as text, never as
 * markup, and a link is only drawn when it is a full https:// address.
 *
 * A band that cannot be loaded says so in one quiet line and the reason is
 * logged. Not an error card: a notice is extra information, and an alarm on
 * every admin page because one request failed would be worse than no notice.
 * But not silence either: "could not be read" must never look like "nothing
 * to read".
 *
 * 🔴 The API client answers `{ success: false }` for a 403 or a 500; it does
 * not throw. Both failure shapes are handled, for loading and for closing.
 *
 * The band keeps itself up to date without a reload (owner, 16 Nov 2026): it
 * asks again when the admin moves to another admin page or comes back to the
 * tab, at most once a minute. So a notice the platform team has ended leaves
 * the screen, and a new one arrives, within a minute of the admin's next
 * move. When asking again fails it keeps what it is showing. A notice closed
 * on this page stays closed even if the server has not caught up yet.
 *
 * `PlatformNoticeView` is the band itself, also used as the live preview
 * where the platform team writes a notice, so what they see is the real thing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ExternalLink from 'lucide-react/icons/external-link';
import Info from 'lucide-react/icons/info';
import TriangleAlert from 'lucide-react/icons/triangle-alert';
import Wrench from 'lucide-react/icons/wrench';
import X from 'lucide-react/icons/x';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { httpsLink, noticeKind, type PlatformNotice, type PlatformNoticeKind } from '@/lib/platformNotice';

const LOOK: Record<PlatformNoticeKind, { band: string; icon: typeof Info }> = {
  // Neutral on purpose: the accent is each community's own colour, and a red or
  // pink community would make plain information look like a warning.
  info: { band: 'border border-divider bg-surface-secondary text-foreground', icon: Info },
  planned_work: { band: 'bg-warning-soft text-warning-soft-foreground', icon: Wrench },
  important: { band: 'bg-danger-soft text-danger-soft-foreground', icon: TriangleAlert },
};

export function PlatformNoticeView({ notice, onClose }: { notice: PlatformNotice; onClose?: () => void }) {
  const { t } = useTranslation('admin_nav');
  const kind = noticeKind(notice.kind);
  const look = LOOK[kind];
  const Icon = look.icon;
  const link = httpsLink(notice.link_url);
  const label = typeof notice.link_label === 'string' ? notice.link_label.trim() : '';

  return (
    <div
      data-testid={`platform-notice-${notice.id}`}
      className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm ${look.band}`}
    >
      <Icon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 break-words">
        <span className="font-semibold">{t(`platform_notice.kind.${kind}`)}</span>{' '}
        <span>{notice.message}</span>
        {link && label ? (
          <>
            {' '}
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium underline underline-offset-2"
            >
              {label}
              <ExternalLink size={13} aria-hidden="true" />
              <span className="sr-only">{t('platform_notice.new_tab')}</span>
            </a>
          </>
        ) : null}
      </p>
      {notice.is_dismissible && onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label={t('platform_notice.close')}
          className="-m-1 shrink-0 rounded-lg p-1 hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-current dark:hover:bg-white/10"
        >
          <X size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/** The band asks the server again no more often than this. */
const ASK_AGAIN_AFTER_MS = 60_000;

export function PlatformNoticeBand() {
  const { t } = useTranslation('admin_nav');
  const { pathname } = useLocation();
  const [notices, setNotices] = useState<PlatformNotice[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const mounted = useRef(true);
  const lastAsked = useRef(0);
  const loadedOnce = useRef(false);
  /** Closed on this page. Kept out even if the server still sends them. */
  const closedHere = useRef(new Set<number>());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    lastAsked.current = Date.now();
    const failed = () => {
      // Before anything has loaded, say so. After that, keep what is showing:
      // a blip must not take a notice off the screen.
      if (mounted.current && !loadedOnce.current) setLoadFailed(true);
    };
    try {
      const res = await api.get<{ notices: PlatformNotice[] }>('/v2/admin/platform-notices');
      if (!mounted.current) return;
      if (res.success && res.data && Array.isArray(res.data.notices)) {
        loadedOnce.current = true;
        setLoadFailed(false);
        setNotices(res.data.notices.filter((n) => !closedHere.current.has(n.id)));
      } else {
        logError('Platform notices could not be loaded', { code: res.code, error: res.error });
        failed();
      }
    } catch (err) {
      logError('Platform notices could not be loaded', err);
      failed();
    }
  }, []);

  // On arrival, and again when the admin moves to another page.
  useEffect(() => {
    if (lastAsked.current === 0 || Date.now() - lastAsked.current >= ASK_AGAIN_AFTER_MS) {
      void load();
    }
  }, [pathname, load]);

  // And when they come back to a tab that has been sitting in the background.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastAsked.current >= ASK_AGAIN_AFTER_MS) {
        void load();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const close = useCallback((id: number) => {
    // Gone from this page at once; the server remembers it for next time.
    closedHere.current.add(id);
    setNotices((current) => current.filter((n) => n.id !== id));
    void api
      .post(`/v2/admin/platform-notices/${id}/dismiss`)
      .then((res) => {
        if (!res.success) {
          logError('Closing a platform notice was not saved', { id, code: res.code, error: res.error });
        }
      })
      .catch((err: unknown) => {
        logError('Closing a platform notice was not saved', err);
      });
  }, []);

  if (loadFailed) {
    return <p className="mb-4 text-xs text-muted">{t('platform_notice.load_failed')}</p>;
  }

  if (notices.length === 0) return null;

  return (
    <section aria-label={t('platform_notice.region_label')} className="mb-4 flex flex-col gap-2">
      {notices.map((notice) => (
        <PlatformNoticeView key={notice.id} notice={notice} onClose={() => close(notice.id)} />
      ))}
    </section>
  );
}

export default PlatformNoticeBand;
