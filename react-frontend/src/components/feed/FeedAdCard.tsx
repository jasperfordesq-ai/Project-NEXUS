// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React, { useEffect, useRef, useState } from 'react';import ExternalLink from 'lucide-react/icons/external-link';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveThumbnailUrl } from '@/lib/helpers';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { openSafeUrl } from '@/lib/safeHref';

export interface AdItem {
  campaign_id: number;
  creative_id: number;
  advertiser_name: string;
  title: string;
  body: string | null;
  image_url: string | null;
  cta_url: string;
  cta_label: string | null;
}

interface ImpressionResponse {
  impression_id: number;
}

interface Props {
  ad: AdItem;
}

export function FeedAdCard({ ad }: Props) {
  const { t } = useTranslation('common');
  const impressionIdRef = useRef<number | null>(null);
  const [isClickLoading, setIsClickLoading] = useState(false);

  // Fire impression on mount
  useEffect(() => {
    let cancelled = false;

    async function recordImpression() {
      try {
        const res = await api.post<ImpressionResponse>('/v2/ads/impression', {
          creative_id: ad.creative_id,
          placement: 'feed',
        });
        if (!cancelled && res.success && res.data?.impression_id) {
          impressionIdRef.current = res.data.impression_id;
        }
      } catch (err) {
        // Ad impression failures must never surface to the user
        logError('Ad impression failed', err);
      }
    }

    void recordImpression();
    return () => { cancelled = true; };
  }, [ad.creative_id]);

  const handleCtaClick = async () => {
    // Open the CTA URL immediately — don't block on the click API call
    openSafeUrl(ad.cta_url);

    if (impressionIdRef.current === null || isClickLoading) return;
    setIsClickLoading(true);
    try {
      await api.post(`/v2/ads/impression/${impressionIdRef.current}/click`);
    } catch (err) {
      logError('Ad click recording failed', err);
    } finally {
      setIsClickLoading(false);
    }
  };

  return (
    <article
      aria-label={t('feed_ad.aria_label')}
      className="rounded-xl border border-theme-default bg-theme-elevated/70 shadow-sm overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-theme-primary">
            {ad.advertiser_name}
          </p>
        </div>
        <Chip
          size="sm"
          variant="flat"
          color="warning"
          classNames={{ base: 'shrink-0', content: 'text-xs font-medium' }}
        >
          {t('feed_ad.sponsored')}
        </Chip>
      </div>

      {/* Creative image */}
      {ad.image_url && (
        <div className="mx-4 mb-3 overflow-hidden rounded-lg">
          <img
            src={resolveThumbnailUrl(ad.image_url, { width: 960, height: 540 })}
            alt={ad.title}
            className="w-full object-cover max-h-64"
            loading="lazy"
          />
        </div>
      )}

      {/* Ad copy */}
      <div className="px-4 pb-3.5 space-y-1.5">
        <p className="font-semibold text-theme-primary text-sm leading-snug">
          {ad.title}
        </p>
        {ad.body && (
          <p className="text-sm text-theme-muted line-clamp-2 leading-relaxed">
            {ad.body}
          </p>
        )}

        {/* CTA */}
        <div className="pt-1.5">
          <Button
            color="primary"
            size="sm"
            endContent={<ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />}
            onPress={() => { void handleCtaClick(); }}
            className="font-medium shadow-sm"
          >
            {ad.cta_label ?? t('feed_ad.cta_default')}
          </Button>
        </div>
      </div>
    </article>
  );
}

export default FeedAdCard;
