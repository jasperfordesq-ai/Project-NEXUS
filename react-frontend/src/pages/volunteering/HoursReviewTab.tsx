// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, useEffect, useCallback, useRef } from 'react';

import Clock from 'lucide-react/icons/clock';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import Building2 from 'lucide-react/icons/building-2';
import ChevronDown from 'lucide-react/icons/chevron-down';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';

import { useTranslation } from 'react-i18next';
interface HourLogUser {
  id: number;
  name: string;
  avatar_url: string | null;
}

interface HourLogOrganization {
  id: number;
  name: string;
  logo_url: string | null;
}

interface HourLogOpportunity {
  id: number;
  title: string;
}

interface HourLogEntry {
  id: number;
  hours: number;
  date: string;
  description: string;
  status: 'pending' | 'approved' | 'declined';
  created_at: string;
  user: HourLogUser;
  organization: HourLogOrganization;
  opportunity: HourLogOpportunity | null;
}

interface PendingHoursResponse {
  items: HourLogEntry[];
  cursor: string | null;
  has_more: boolean;
}

const formatDate = (dateStr: string) => {
  try {
    return new Date(dateStr).toLocaleDateString(getFormattingLocale(), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
};

const statusColor = (status: HourLogEntry['status']): 'success' | 'danger' | 'warning' => {
  switch (status) {
    case 'approved': return 'success';
    case 'declined': return 'danger';
    default: return 'warning';
  }
};

export function HoursReviewTab() {
  const toast = useToast();
  const { t } = useTranslation('volunteering');
  const [entries, setEntries] = useState<HourLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const [actionInFlight, setActionInFlight] = useState<Set<number>>(new Set());

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const loadEntries = useCallback(async (append = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setError(null);
      }

      const params = new URLSearchParams();
      params.set('per_page', '20');
      if (append && cursorRef.current) params.set('cursor', cursorRef.current);

      const response = await api.get<PendingHoursResponse>(
        `/v2/volunteering/hours/pending-review?${params}`,
      );

      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        const { items, cursor: nextCursor, has_more } = response.data;
        if (append) {
          setEntries((prev) => [...prev, ...items]);
        } else {
          setEntries(items);
        }
        cursorRef.current = nextCursor;
        setHasMore(has_more);
      } else {
        // A non-thrown success:false must not fall through and render the
        // "All hours reviewed" empty state — surface a retryable error instead.
        if (append) {
          toastRef.current.error(tRef.current('hours_load_failed'));
        } else {
          setError(tRef.current('hours_load_failed'));
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load pending hours', err);
      if (append) {
        toastRef.current.error(tRef.current('hours_load_failed'));
      } else {
        setError(tRef.current('hours_load_failed'));
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    loadEntries();
    return () => {
      abortRef.current?.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  const handleAction = async (entryId: number, action: 'approve' | 'decline') => {
    setActionInFlight((prev) => new Set(prev).add(entryId));

    setEntries((prev) =>
      prev.map((e) =>
        e.id === entryId
          ? { ...e, status: action === 'approve' ? 'approved' : 'declined' }
          : e,
      ),
    );

    try {
      const response = await api.put(`/v2/volunteering/hours/${entryId}/verify`, { action });

      if (response.success) {
        toastRef.current.success(action === 'approve' ? tRef.current('hours_approved') : tRef.current('hours_declined'));
        setTimeout(() => {
          setEntries((prev) => prev.filter((e) => e.id !== entryId));
        }, 800);
      } else {
        setEntries((prev) =>
          prev.map((e) => (e.id === entryId ? { ...e, status: 'pending' } : e)),
        );
        toastRef.current.error(response.error ?? tRef.current('something_wrong'));
      }
    } catch (err) {
      logError('Failed to verify hours', err);
      setEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, status: 'pending' } : e)),
      );
      toastRef.current.error(tRef.current('something_wrong'));
    } finally {
      setActionInFlight((prev) => {
        const next = new Set(prev);
        next.delete(entryId);
        return next;
      });
    }
  };

  if (isLoading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('loading')} className="flex items-center justify-center py-16">
        <Spinner size="lg" color="accent" />
      </div>
    );
  }

  if (error) {
    return (
      <GlassCard className="p-8 text-center" role="alert">
        <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
        <p className="text-theme-muted mb-4">{error}</p>
        <Button className="bg-gradient-to-r from-rose-500 to-pink-600 text-white" onPress={() => loadEntries()}>
          {t('try_again')}
        </Button>
      </GlassCard>
    );
  }

  if (entries.length === 0) {
    return (
      <GlassCard className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-100 to-pink-100 dark:from-rose-900/30 dark:to-pink-900/30 flex items-center justify-center">
          <Clock className="w-7 h-7 text-rose-400" aria-hidden="true" />
        </div>
        <p className="text-[var(--color-text)] font-semibold text-lg">{t('no_pending_hours')}</p>
        <p className="text-[var(--color-text-muted)] text-sm max-w-xs">
          {t('all_hours_reviewed')}
        </p>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-4">
      {entries.map((entry) => {
        const inFlight = actionInFlight.has(entry.id);
        const isActioned = entry.status !== 'pending';

        return (
          <GlassCard
            key={entry.id}
            className={`flex flex-col sm:flex-row sm:items-start gap-4 p-4 transition-all duration-300 ${
              isActioned && !inFlight
                ? entry.status === 'approved'
                  ? 'ring-2 ring-emerald-500/40 bg-emerald-500/5'
                  : 'ring-2 ring-danger/40 bg-danger/5 opacity-70'
                : ''
            }`}
          >
            <Avatar
              src={resolveAvatarUrl(entry.user.avatar_url) || undefined}
              name={entry.user.name}
              size="md"
              className="shrink-0"
            />

            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-[var(--color-text)]">{entry.user.name}</span>
                <Chip size="sm" color={statusColor(entry.status)} variant="soft">
                  {entry.status === 'approved'
                    ? t('status_approved')
                    : entry.status === 'declined'
                      ? t('status_declined')
                      : t('status_pending')}
                </Chip>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--color-text-muted)]">
                <span className="flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  {entry.organization.name}
                </span>
                {entry.opportunity && (
                  <span>· {entry.opportunity.title}</span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="flex items-center gap-1 text-rose-700 font-medium">
                  <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  {entry.hours} {entry.hours === 1 ? t('hour') : t('hours')}
                </span>
                <span className="text-[var(--color-text-muted)]">{formatDate(entry.date)}</span>
              </div>

              {entry.description && (
                <p className="text-sm text-[var(--color-text-muted)] line-clamp-2 mt-1">
                  {entry.description}
                </p>
              )}
            </div>

            <div className="flex gap-2 sm:shrink-0 sm:flex-col">
              <Button
                size="sm"
                variant="secondary"
                className="bg-success-soft text-success hover:bg-success-soft/80"
                isDisabled={inFlight || isActioned}
                isLoading={inFlight && entry.status === 'approved'}
                startContent={!inFlight ? <CheckCircle className="w-4 h-4" aria-hidden="true" /> : undefined}
                onPress={() => handleAction(entry.id, 'approve')}
                aria-label={t('hours_review.approve_aria', { name: entry.user.name })}
              >
                {t('hours_review.approve')}
              </Button>
              <Button
                size="sm"
                variant="danger-soft"
                isDisabled={inFlight || isActioned}
                isLoading={inFlight && entry.status === 'declined'}
                startContent={!inFlight ? <XCircle className="w-4 h-4" aria-hidden="true" /> : undefined}
                onPress={() => handleAction(entry.id, 'decline')}
                aria-label={t('hours_review.decline_aria', { name: entry.user.name })}
              >
                {t('hours_review.decline')}
              </Button>
            </div>
          </GlassCard>
        );
      })}

      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button
            variant="tertiary"
            isLoading={isLoadingMore}
            startContent={!isLoadingMore ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : undefined}
            onPress={() => loadEntries(true)}
          >
            {t('load_more')}
          </Button>
        </div>
      )}
    </div>
  );
}
