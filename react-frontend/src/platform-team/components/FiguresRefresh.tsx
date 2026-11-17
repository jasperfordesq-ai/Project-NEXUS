// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The "Check again" button of a Platform team page whose figures the server
 * keeps for a short while (community health, usage, community setup, data
 * requests, legal documents, push notifications).
 *
 * The page's first load uses the kept figures; this button asks the server to
 * work them out again (`refresh=1`). Under the button: when the figures shown
 * were worked out (only when the server says; an older server does not), and,
 * when the server refused to work them out again so soon, a short line saying
 * so. A refusal keeps what is on screen.
 */

import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import RefreshCw from 'lucide-react/icons/refresh-cw';

/** The address with `refresh=1` added when asked, keeping any question it already has. */
export function withRefresh(url: string, refresh: boolean): string {
  if (!refresh) return url;
  return `${url}${url.includes('?') ? '&' : '?'}refresh=1`;
}

interface FiguresRefreshProps {
  onRefresh: () => void;
  loading: boolean;
  /** The server's `generated_at`; undefined or null from an older server. */
  generatedAt: string | null | undefined;
  /** The last "Check again" was refused (too many in a short time). */
  refused: boolean;
}

export function FiguresRefresh({ onRefresh, loading, generatedAt, refused }: FiguresRefreshProps) {
  const { t, i18n } = useTranslation('platform_team');

  const when = generatedAt ? new Date(generatedAt) : null;
  const time =
    when && !Number.isNaN(when.getTime()) ? when.toLocaleTimeString(i18n.language, { timeStyle: 'short' }) : null;

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button variant="tertiary" onPress={onRefresh} isDisabled={loading}>
        <RefreshCw size={16} aria-hidden="true" />
        {t('home.refresh')}
      </Button>
      {time ? <p className="text-xs text-muted">{t('shared.figures_from', { time })}</p> : null}
      {refused ? (
        <p role="status" className="max-w-xs text-xs text-warning-soft-foreground sm:text-end">
          {t('translations.recount_refused')}
        </p>
      ) : null}
    </div>
  );
}

export default FiguresRefresh;
