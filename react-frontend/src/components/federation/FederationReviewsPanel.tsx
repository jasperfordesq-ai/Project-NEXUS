// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Card, CardBody, Chip, Avatar, Skeleton } from '@/components/ui';

/**
 * FederationReviewsPanel
 *
 * Fetches and renders cross-federation reviews for a given federated member id.
 * Gracefully handles the case where the backend endpoint is not yet available
 * (404) by showing a friendly "not yet available" message.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import Globe from 'lucide-react/icons/globe';
import MessageSquare from 'lucide-react/icons/message-square';
import Star from 'lucide-react/icons/star';
import StarHalf from 'lucide-react/icons/star-half';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { getFormattingLocale, resolveAvatarUrl, resolveUserDisplayName } from '@/lib/helpers';
import { logError } from '@/lib/logger';

export interface FederationReviewItem {
  id: number | string;
  rating: number;
  comment?: string | null;
  created_at: string;
  reviewer: {
    id?: number | string;
    name?: string;
    first_name?: string;
    last_name?: string;
    avatar?: string | null;
  };
  partner?: {
    id?: number | string;
    name: string;
    slug?: string;
  };
  verified?: boolean;
}

interface FederationReviewsPanelProps {
  memberId: string | number;
  tenantId?: string | number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Star rating (5-star, half-star support)
// ─────────────────────────────────────────────────────────────────────────────

function StarRating({ rating, ariaLabel }: { rating: number; ariaLabel: string }) {
  const safe = Math.max(0, Math.min(5, Number(rating) || 0));
  const stars: React.ReactNode[] = [];
  for (let i = 1; i <= 5; i++) {
    const diff = safe - (i - 1);
    if (diff >= 1) {
      stars.push(
        <Star
          key={i}
          className="w-4 h-4 fill-amber-400 text-amber-400"
          aria-hidden="true"
        />
      );
    } else if (diff >= 0.5) {
      stars.push(
        <StarHalf
          key={i}
          className="w-4 h-4 fill-amber-400 text-amber-400"
          aria-hidden="true"
        />
      );
    } else {
      stars.push(
        <Star
          key={i}
          className="w-4 h-4 text-theme-subtle"
          aria-hidden="true"
        />
      );
    }
  }
  return (
    <div className="flex items-center gap-0.5" role="img" aria-label={ariaLabel}>
      {stars}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function reviewerName(r: FederationReviewItem['reviewer']): string {
  return (
    resolveUserDisplayName(r) ||
    ''
  );
}

function partnerChipClass(partnerId: number | string | undefined): string {
  // Deterministic color-coding by partner id
  const palette = [
    'bg-accent/10 text-accent dark:text-accent',
    'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    'bg-accent/10 text-accent dark:text-accent',
  ];
  const str = String(partnerId ?? '0');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length] ?? palette[0]!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function FederationReviewsPanel({ memberId, tenantId }: FederationReviewsPanelProps) {
  const { t } = useTranslation('federation');
  const [reviews, setReviews] = useState<FederationReviewItem[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // Keep `t` out of the load deps: its identity changes when the i18n
  // namespace finishes loading, which would trigger a duplicate fetch.
  const tRef = useRef(t);
  tRef.current = t;

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    setError(null);
    setUnavailable(false);
    try {
      const tenantQuery = tenantId ? `?tenant_id=${encodeURIComponent(String(tenantId))}` : '';
      const response = await api.get<FederationReviewItem[]>(
        `/v2/federation/members/${memberId}/reviews${tenantQuery}`,
        { signal: controller.signal }
      );
      if (controller.signal.aborted) return;
      if (response.success && Array.isArray(response.data)) {
        setReviews(response.data);
      } else {
        // Treat 404 / missing endpoint as "not yet available". The api client's
        // failure envelope carries a `code` (backend code or HTTP_<status>),
        // never a `status` field — and never a locale-dependent message.
        const code = response.code ?? '';
        if (code === 'NOT_FOUND' || code === 'HTTP_404') {
          setUnavailable(true);
        } else {
          setError(tRef.current('reviews.load_error'));
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      // api.get resolves with a failure envelope rather than throwing; this
      // only catches unexpected runtime errors.
      logError('Failed to load federation reviews', err);
      setError(tRef.current('reviews.load_error'));
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, [memberId, tenantId]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  // ─── Loading ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-3" role="status" aria-busy="true" aria-label={t('common:loading')}>
        {[0, 1, 2].map((i) => (
          <Card key={i} className="bg-theme-elevated">
            <CardBody className="gap-3">
              <div className="flex items-center gap-3">
                <Skeleton className="w-10 h-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-1/3 rounded" />
                  <Skeleton className="h-3 w-1/5 rounded" />
                </div>
              </div>
              <Skeleton className="h-3 w-full rounded" />
              <Skeleton className="h-3 w-4/5 rounded" />
            </CardBody>
          </Card>
        ))}
      </div>
    );
  }

  // ─── Not yet available (404) ────────────────────────────────────────────
  if (unavailable) {
    return (
      <Card className="bg-theme-elevated">
        <CardBody className="items-center text-center gap-3 py-8">
          <MessageSquare className="w-10 h-10 text-theme-subtle" aria-hidden="true" />
          <p className="text-theme-muted max-w-md">
            {t('reviews.unavailable')}
          </p>
        </CardBody>
      </Card>
    );
  }

  // ─── Error ──────────────────────────────────────────────────────────────
  if (error) {
    return (
      <Card className="bg-theme-elevated">
        <CardBody className="items-center text-center gap-3 py-8">
          <AlertTriangle className="w-10 h-10 text-[var(--color-warning)]" aria-hidden="true" />
          <p className="text-theme-muted">{error}</p>
        </CardBody>
      </Card>
    );
  }

  // ─── Empty ──────────────────────────────────────────────────────────────
  if (!reviews || reviews.length === 0) {
    return (
      <Card className="bg-theme-elevated">
        <CardBody className="items-center text-center gap-3 py-10">
          <Star className="w-10 h-10 text-theme-subtle" aria-hidden="true" />
          <p className="text-theme-muted">{t('reviews.empty')}</p>
        </CardBody>
      </Card>
    );
  }

  // ─── List ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {reviews.map((r) => {
        const name = reviewerName(r.reviewer) || t('reviews.anonymous');
        const ratingLabel = t('reviews.rating_label', {
          rating: r.rating,
        });
        const formattedDate = (() => {
          try {
            return new Date(r.created_at).toLocaleDateString(getFormattingLocale(), {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            });
          } catch {
            return r.created_at;
          }
        })();

        return (
          <Card key={r.id} className="bg-theme-elevated">
            <CardBody className="gap-3">
              <div className="flex items-start gap-3">
                <Avatar
                  src={resolveAvatarUrl(r.reviewer.avatar ?? undefined)}
                  name={name}
                  className="w-10 h-10 flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-theme-primary truncate">{name}</p>
                    {r.partner?.name && (
                      <Chip
                        size="sm"
                        variant="flat"
                        className={partnerChipClass(r.partner.id)}
                        startContent={<Globe className="w-3 h-3" aria-hidden="true" />}
                      >
                        {t('reviews.from_partner', {
                          partner: r.partner.name,
                        })}
                      </Chip>
                    )}
                    {r.verified && (
                      <Chip
                        size="sm"
                        variant="flat"
                        className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      >
                        {t('reviews.verified')}
                      </Chip>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <StarRating rating={r.rating} ariaLabel={ratingLabel} />
                    <span className="text-xs text-theme-subtle">{formattedDate}</span>
                  </div>
                </div>
              </div>
              {r.comment && (
                <p className="text-sm text-theme-muted whitespace-pre-line">{r.comment}</p>
              )}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

export default FederationReviewsPanel;
