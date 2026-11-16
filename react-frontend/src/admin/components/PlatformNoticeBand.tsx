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
 * A band that cannot be loaded takes up no room and the reason is logged:
 * a notice is extra information, and an error card on every admin page
 * because one request failed would be worse than no notice.
 *
 * `PlatformNoticeView` is the band itself, also used as the live preview
 * where the platform team writes a notice, so what they see is the real thing.
 */

import { useCallback, useEffect, useState } from 'react';
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

export function PlatformNoticeBand() {
  const { t } = useTranslation('admin_nav');
  const [notices, setNotices] = useState<PlatformNotice[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<{ notices: PlatformNotice[] }>('/v2/admin/platform-notices');
        if (!cancelled && res.success && res.data && Array.isArray(res.data.notices)) {
          setNotices(res.data.notices);
        }
      } catch (err) {
        logError('Platform notices could not be loaded', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const close = useCallback((id: number) => {
    // Gone from this page at once; the server remembers it for next time.
    setNotices((current) => current.filter((n) => n.id !== id));
    void api.post(`/v2/admin/platform-notices/${id}/dismiss`).catch((err: unknown) => {
      logError('Closing a platform notice was not saved', err);
    });
  }, []);

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
