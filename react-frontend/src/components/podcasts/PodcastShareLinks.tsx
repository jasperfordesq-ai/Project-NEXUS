// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { useTenant, useToast } from '@/contexts';
import { API_BASE } from '@/lib/api';
import type { PodcastShow } from '@/lib/api/podcasts';
import Copy from 'lucide-react/icons/copy';
import Share2 from 'lucide-react/icons/share-2';

interface PodcastShareLinksProps {
  show: Pick<PodcastShow, 'slug' | 'status' | 'moderation_status' | 'visibility'>;
  /** Community setting: whether public shows get a podcast-app (RSS) feed. */
  rssEnabled: boolean;
}

/** API_BASE may be relative ('/api'); a link people paste elsewhere must be absolute. */
function absoluteApiBase(): string {
  return /^https?:\/\//i.test(API_BASE) ? API_BASE : `${window.location.origin}${API_BASE}`;
}

/**
 * The two links a creator can hand out once a show is live:
 *  - the show page, which members open after signing in (podcast pages are
 *    behind sign-in, so it is NOT a public link);
 *  - for Public shows, the RSS feed, which works without signing in — the
 *    link podcast apps and directories take.
 * Each link is shown in full as selectable text, so it can still be copied by
 * hand where the clipboard is blocked.
 */
export function PodcastShareLinks({ show, rssEnabled }: PodcastShareLinksProps) {
  const { t } = useTranslation('podcasts');
  const { tenant, tenantPath } = useTenant();
  const toast = useToast();

  if (show.status !== 'published' || show.moderation_status !== 'approved') {
    return <p className="text-xs text-muted">{t('studio.share.not_ready')}</p>;
  }

  const showUrl = `${window.location.origin}${tenantPath(`/podcasts/${show.slug}`)}`;
  const feedUrl = tenant?.id
    ? `${absoluteApiBase()}/v2/podcasts/feed/${tenant.id}/${encodeURIComponent(show.slug)}.xml`
    : `${absoluteApiBase()}/v2/podcasts/${encodeURIComponent(show.slug)}/feed.xml`;
  const isPublic = show.visibility === 'public';

  async function copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('studio.share.copied'));
    } catch {
      toast.error(t('studio.share.copy_failed'));
    }
  }

  const rows: { key: string; label: string; hint: string; url: string }[] = [
    { key: 'show', label: t('studio.share.show_link'), hint: t('studio.share.show_link_hint'), url: showUrl },
  ];
  if (rssEnabled && isPublic) {
    rows.push({ key: 'feed', label: t('studio.share.feed_link'), hint: t('studio.share.feed_link_hint'), url: feedUrl });
  }

  return (
    <div className="space-y-2 rounded-md border border-border px-3 py-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <Share2 size={14} aria-hidden="true" />
        {t('studio.share.title')}
      </h3>
      {rows.map((row) => (
        <div key={row.key} className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{row.label}</span>
            <Button
              size="sm"
              variant="tertiary"
              startContent={<Copy size={14} aria-hidden="true" />}
              aria-label={`${t('studio.share.copy')}: ${row.label}`}
              onPress={() => copy(row.url)}
            >
              {t('studio.share.copy')}
            </Button>
          </div>
          <p className="break-all rounded bg-surface-secondary/70 px-2 py-1 font-mono text-xs select-all">{row.url}</p>
          <p className="text-xs text-muted">{row.hint}</p>
        </div>
      ))}
      {rssEnabled && !isPublic && (
        <p className="text-xs text-muted">{t('studio.share.feed_needs_public', { public: t('visibility.public') })}</p>
      )}
    </div>
  );
}
