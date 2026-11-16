// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Rebuild search (idea 31).
 *
 * Lists every community with the last search rebuild started from this page,
 * and starts a rebuild of one community's search as a background job.
 *
 * 🔴 A rebuild adds and updates entries. It does not empty the community's
 * search first (that would leave search empty until it ends), so entries for
 * things that were deleted stay. The confirmation says so.
 *
 * While any community is waiting or running the list refreshes every 10
 * seconds, and stops when none is. A list that cannot be loaded shows the
 * error card, never an empty list.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, Chip, Spinner } from '@/components/ui';
import { ConfirmModal } from '@/admin/components/ConfirmModal';
import { LoadError } from '@/components/feedback/LoadError';
import { useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import CheckCircle from 'lucide-react/icons/circle-check';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import SearchIcon from 'lucide-react/icons/search';

type RebuildState = 'queued' | 'running' | 'done' | 'failed';

interface LastRebuild {
  state: RebuildState;
  started_at: string | null;
  finished_at: string | null;
  counts: Record<string, number> | null;
  errors: number;
}

interface CommunityRow {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
  last: LastRebuild | null;
}

interface SearchRebuildOverview {
  search_available: boolean;
  communities: CommunityRow[];
}

const REFRESH_MS = 10_000;

/** The server's refusal codes, said in the page's own words. */
const REFUSAL_KEYS: Record<string, 'search_rebuild.busy' | 'search_rebuild.unavailable'> = {
  ALREADY_RUNNING: 'search_rebuild.busy',
  SEARCH_UNAVAILABLE: 'search_rebuild.unavailable',
};

function isBusy(last: LastRebuild | null): boolean {
  return last !== null && (last.state === 'queued' || last.state === 'running');
}

export function SearchRebuildPage() {
  const { t, i18n } = useTranslation('platform_team');
  const toast = useToast();
  usePageTitle(t('search_rebuild.title'));

  const [overview, setOverview] = useState<SearchRebuildOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [toRebuild, setToRebuild] = useState<CommunityRow | null>(null);
  /** When a check made in the background last failed; cleared by the next good one. */
  const [checkFailedAt, setCheckFailedAt] = useState<Date | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoading(true);
      setFailed(false);
    }
    try {
      const res = await api.get<SearchRebuildOverview>('/v2/platform-team/search-rebuild');
      if (res.success && res.data && Array.isArray(res.data.communities)) {
        setOverview(res.data);
        setFailed(false);
        setCheckFailedAt(null);
      } else if (!quiet) {
        setOverview(null);
        setFailed(true);
      } else {
        setCheckFailedAt(new Date());
      }
    } catch (err) {
      logError('Failed to load the search rebuild list', err);
      if (!quiet) {
        setOverview(null);
        setFailed(true);
      } else {
        setCheckFailedAt(new Date());
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const anyBusy = overview?.communities.some((c) => isBusy(c.last)) ?? false;

  useEffect(() => {
    if (!anyBusy) return undefined;
    const timer = setInterval(() => {
      void load(true);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [anyBusy, load]);

  const start = async (community: CommunityRow) => {
    setBusyId(community.id);
    try {
      const res = await api.post<{ queued: boolean }>('/v2/platform-team/search-rebuild', { tenant_id: community.id });
      if (res.success) {
        toast.success(t('search_rebuild.started'));
        await load(true);
      } else {
        const refusal = REFUSAL_KEYS[res.code ?? ''];
        toast.error(refusal ? t(refusal) : t('search_rebuild.action_failed'));
        if (refusal) await load(true);
      }
    } catch (err) {
      logError('Search rebuild could not be started', err);
      toast.error(t('search_rebuild.action_failed'));
    } finally {
      setBusyId(null);
    }
  };

  const when = (iso: string | null): string => {
    if (!iso) return t('home.value.not_known');
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? t('home.value.not_known') : date.toLocaleString(i18n.language);
  };

  const describe = (last: LastRebuild | null): string => {
    if (last === null) return t('search_rebuild.last.never');
    switch (last.state) {
      case 'queued':
        return t('search_rebuild.last.queued');
      case 'running':
        return t('search_rebuild.last.running', { time: when(last.started_at) });
      case 'done': {
        if (last.errors > 0) {
          return t('search_rebuild.last.done_with_errors', { count: last.errors, time: when(last.finished_at) });
        }
        const total = Object.values(last.counts ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
        return t('search_rebuild.last.done', { count: total, time: when(last.finished_at) });
      }
      default:
        return t('search_rebuild.last.failed');
    }
  };

  return (
    <section className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('search_rebuild.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">{t('search_rebuild.intro')}</p>
        </div>
        <Button variant="tertiary" onPress={() => void load()} isDisabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />
          {t('home.refresh')}
        </Button>
      </div>

      {loading && !overview ? (
        <div role="status" aria-busy="true" aria-label={t('search_rebuild.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !overview ? (
        <LoadError title={t('search_rebuild.load_error_title')} onRetry={() => void load()} />
      ) : (
        <>
          <p className="mb-2 flex items-center gap-2 text-sm font-medium" aria-live="polite">
            {overview.search_available ? (
              <>
                <CheckCircle size={16} className="text-success" aria-hidden="true" />
                <span className="text-foreground">{t('search_rebuild.available')}</span>
              </>
            ) : (
              <>
                <AlertTriangle size={16} className="text-warning" aria-hidden="true" />
                <span className="text-foreground">{t('search_rebuild.unavailable')}</span>
              </>
            )}
          </p>
          <ul className="mb-4 list-disc space-y-1 ps-5 text-sm text-muted">
            <li>{t('search_rebuild.does.adds')}</li>
            <li>{t('search_rebuild.does.not_removed')}</li>
            <li>{t('search_rebuild.does.keep_searching')}</li>
          </ul>
          {anyBusy && <p className="mb-3 text-sm text-muted">{t('search_rebuild.auto_refresh')}</p>}
          {checkFailedAt !== null && (
            <p className="mb-3 text-sm font-medium text-warning-soft-foreground" role="status">
              {t('search_rebuild.check_failed', { time: checkFailedAt.toLocaleTimeString(i18n.language) })}
            </p>
          )}

          <ul className="flex flex-col gap-3">
            {overview.communities.map((community) => (
              <li key={community.id} data-testid={`search-rebuild-${community.id}`}>
                <Card>
                  <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground">
                        <span className="break-words">{community.name}</span>
                        {!community.is_active && (
                          <Chip size="sm" variant="soft">
                            {t('search_rebuild.switched_off')}
                          </Chip>
                        )}
                      </h2>
                      <p className="mt-1 break-words text-sm text-muted">{describe(community.last)}</p>
                    </div>
                    <div className="flex shrink-0">
                      <Button
                        size="sm"
                        variant="secondary"
                        isLoading={busyId === community.id}
                        isDisabled={busyId !== null || isBusy(community.last) || !overview.search_available}
                        onPress={() => setToRebuild(community)}
                      >
                        <SearchIcon size={14} aria-hidden="true" />
                        {t('search_rebuild.rebuild')}
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      <ConfirmModal
        isOpen={toRebuild !== null}
        onClose={() => setToRebuild(null)}
        onConfirm={() => {
          const community = toRebuild;
          setToRebuild(null);
          if (community) void start(community);
        }}
        title={t('search_rebuild.confirm_title', { name: toRebuild?.name ?? '' })}
        message={t('search_rebuild.confirm_message')}
        confirmLabel={t('search_rebuild.rebuild')}
        cancelLabel={t('search_rebuild.cancel')}
      />
    </section>
  );
}

export default SearchRebuildPage;
