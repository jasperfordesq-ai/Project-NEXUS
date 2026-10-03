// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Chip, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import type { AdminSupportReportScreenshot } from '../../api/types';

interface SupportReportScreenshotsProps {
  reportId: number;
  screenshots: AdminSupportReportScreenshot[];
}

/**
 * The member's screenshots on a support report (HELP-11). They are kept on the
 * private disk, so each is fetched with the admin's own credentials and shown
 * from a local object URL; there is no public address to link to.
 */
export function SupportReportScreenshots({ reportId, screenshots }: SupportReportScreenshotsProps) {
  const { t } = useTranslation('admin_support');
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [failed, setFailed] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    setUrls({});
    setFailed([]);

    screenshots.forEach((shot) => {
      api.download(`/v2/admin/support-reports/${reportId}/screenshots/${shot.id}`)
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          created.push(url);
          if (!cancelled) setUrls((prev) => ({ ...prev, [shot.id]: url }));
        })
        .catch((error: unknown) => {
          logError('Failed to load support report screenshot', error);
          if (!cancelled) setFailed((prev) => [...prev, shot.id]);
        });
    });

    return () => {
      cancelled = true;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [reportId, screenshots]);

  if (screenshots.length === 0) return null;

  return (
    <section data-testid="support-report-screenshots">
      <p className="mb-2 text-xs font-semibold uppercase text-muted">
        {t('support_reports.detail.screenshots', { count: screenshots.length })}
      </p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {screenshots.map((shot, index) => {
          const url = urls[shot.id];
          const label = t('support_reports.detail.screenshot_label', { number: index + 1 });
          return (
            <li key={shot.id} className="space-y-1">
              <div className="flex aspect-video items-center justify-center overflow-hidden rounded-md border border-divider bg-surface-secondary">
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" aria-label={t('support_reports.detail.screenshot_open', { label })}>
                    <img src={url} alt={label} className="max-h-full max-w-full object-contain" />
                  </a>
                ) : failed.includes(shot.id) ? (
                  <span className="px-2 text-center text-xs text-muted">{t('support_reports.detail.screenshot_failed')}</span>
                ) : (
                  <Spinner size="sm" aria-label={t('support_reports.detail.screenshot_loading')} />
                )}
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted">
                <span>{shot.width} × {shot.height}</span>
                {shot.in_jira ? <Chip size="sm" variant="soft">{t('support_reports.detail.screenshot_in_jira')}</Chip> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
