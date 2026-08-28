// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef, useState } from 'react';
import History from 'lucide-react/icons/history';
import ShieldCheck from 'lucide-react/icons/shield-check';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Spinner } from '@/components/ui/Spinner';
import {
  eventLifecycleHistoryApi,
  type EventLifecycleHistoryEntry,
} from '@/lib/event-lifecycle-history-api';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';

interface EventLifecycleHistoryPanelProps {
  eventId: number;
}

function appendUnique(
  current: EventLifecycleHistoryEntry[],
  incoming: EventLifecycleHistoryEntry[],
): EventLifecycleHistoryEntry[] {
  const seen = new Set(current.map((entry) => entry.id));
  return [...current, ...incoming.filter((entry) => !seen.has(entry.id))];
}

export function EventLifecycleHistoryPanel({ eventId }: EventLifecycleHistoryPanelProps) {
  const { t } = useTranslation('event_lifecycle_history');
  const generationRef = useRef(0);
  const initialAbortRef = useRef<AbortController | null>(null);
  const moreAbortRef = useRef<AbortController | null>(null);
  const [entries, setEntries] = useState<EventLifecycleHistoryEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    initialAbortRef.current?.abort();
    moreAbortRef.current?.abort();
    const controller = new AbortController();
    initialAbortRef.current = controller;
    setEntries([]);
    setNextCursor(null);
    setLoadError(false);
    setLoadMoreError(false);
    setIsLoadingMore(false);
    setIsLoading(true);

    void eventLifecycleHistoryApi.list(eventId, undefined, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        if (!response.success || !response.data || !response.meta) {
          setLoadError(true);
          return;
        }
        setEntries(response.data);
        setNextCursor(response.meta.next_cursor);
      })
      .catch((error) => {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        logError('Failed to load Event lifecycle history', error);
        setLoadError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted && generation === generationRef.current) {
          setIsLoading(false);
        }
      });

    return () => {
      controller.abort();
      moreAbortRef.current?.abort();
      generationRef.current += 1;
    };
  }, [eventId, retryToken]);

  async function loadMore(): Promise<void> {
    if (!nextCursor || isLoadingMore) return;
    moreAbortRef.current?.abort();
    const controller = new AbortController();
    moreAbortRef.current = controller;
    const generation = generationRef.current;
    const cursor = nextCursor;
    setLoadMoreError(false);
    setIsLoadingMore(true);
    try {
      const response = await eventLifecycleHistoryApi.list(
        eventId,
        cursor,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || generation !== generationRef.current) return;
      if (!response.success || !response.data || !response.meta) {
        setLoadMoreError(true);
        return;
      }
      setEntries((current) => appendUnique(current, response.data!));
      setNextCursor(response.meta.next_cursor);
    } catch (error) {
      if (controller.signal.aborted || generation !== generationRef.current) return;
      logError('Failed to load more Event lifecycle history', error);
      setLoadMoreError(true);
    } finally {
      if (!controller.signal.aborted && generation === generationRef.current) {
        setIsLoadingMore(false);
      }
    }
  }

  function dateLabel(value: string | null): string {
    if (!value) return t('timestamp_unknown');
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return t('timestamp_unknown');

    return new Intl.DateTimeFormat(getFormattingLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(parsed);
  }

  function stateLabel(axis: 'publication' | 'operational', state: string): string {
    return t(`states.${axis}.${state}`);
  }

  return (
    <Card className="border border-theme-default bg-theme-surface" role="region" aria-labelledby="event-lifecycle-history-heading">
      <CardHeader className="flex items-start gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
        <History className="mt-0.5 h-5 w-5 shrink-0 text-theme-secondary" aria-hidden="true" />
        <div>
          <h2 id="event-lifecycle-history-heading" className="text-lg font-semibold text-theme-primary">
            {t('title')}
          </h2>
          <p className="mt-1 text-sm text-theme-muted">{t('description')}</p>
        </div>
      </CardHeader>
      <CardBody className="space-y-4 px-5 pb-5 sm:px-6 sm:pb-6">
        {isLoading ? (
          <div className="flex min-h-28 items-center justify-center gap-3" role="status">
            <Spinner size="sm" />
            <span className="text-sm text-theme-muted">{t('loading')}</span>
          </div>
        ) : loadError ? (
          <Alert
            color="danger"
            title={t('load_error_title')}
            description={t('load_error_description')}
            endContent={(
              <Button size="sm" variant="secondary" onPress={() => setRetryToken((value) => value + 1)}>
                {t('retry')}
              </Button>
            )}
          />
        ) : entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-theme-default bg-theme-elevated p-5 text-center">
            <p className="font-medium text-theme-primary">{t('empty_title')}</p>
            <p className="mt-1 text-sm text-theme-muted">{t('empty_description')}</p>
          </div>
        ) : (
          <>
            <ol className="space-y-3" aria-label={t('list_label')}>
              {entries.map((entry) => {
                const cascadeEntries = Object.entries(entry.evidence.cascade)
                  .filter(([, count]) => typeof count === 'number' && count > 0);
                return (
                  <li key={entry.id} className="rounded-xl border border-theme-default bg-theme-elevated p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-theme-primary">
                          {t('version', { version: entry.lifecycle_version })}
                        </h3>
                        <p className="mt-0.5 text-xs text-theme-subtle">{dateLabel(entry.created_at)}</p>
                      </div>
                      <Chip size="sm" color="success" variant="flat">
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('immutable')}
                      </Chip>
                    </div>

                    <dl className="mt-3 space-y-2 text-sm">
                      {entry.evidence.axes_changed.includes('publication') && (
                        <div className="grid gap-0.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                          <dt className="font-medium text-theme-muted">{t('publication_label')}</dt>
                          <dd className="text-theme-primary">
                            {t('transition', {
                              from: stateLabel('publication', entry.publication.from),
                              to: stateLabel('publication', entry.publication.to),
                            })}
                          </dd>
                        </div>
                      )}
                      {entry.evidence.axes_changed.includes('operational') && (
                        <div className="grid gap-0.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                          <dt className="font-medium text-theme-muted">{t('operational_label')}</dt>
                          <dd className="text-theme-primary">
                            {t('transition', {
                              from: stateLabel('operational', entry.operational.from),
                              to: stateLabel('operational', entry.operational.to),
                            })}
                          </dd>
                        </div>
                      )}
                      <div className="grid gap-0.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                        <dt className="font-medium text-theme-muted">{t('actor_label')}</dt>
                        <dd className="text-theme-primary">
                          {entry.actor.display_name ?? t('unknown_actor', { id: entry.actor.id })}
                        </dd>
                      </div>
                      {entry.reason && (
                        <div className="grid gap-0.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                          <dt className="font-medium text-theme-muted">{t('reason_label')}</dt>
                          <dd className="whitespace-pre-wrap text-theme-primary">{entry.reason}</dd>
                        </div>
                      )}
                    </dl>

                    {(cascadeEntries.length > 0 || entry.evidence.series || entry.evidence.notifications_suppressed) && (
                      <div className="mt-3 border-t border-theme-default pt-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-theme-subtle">
                          {t('evidence_title')}
                        </p>
                        <ul className="mt-1 list-inside list-disc space-y-1 text-xs text-theme-muted">
                          {cascadeEntries.map(([key, count]) => (
                            <li key={key}>{t(`cascade.${key}`, { count })}</li>
                          ))}
                          {entry.evidence.series && (
                            <li>{t(`series.${entry.evidence.series.member_type}`, {
                              id: entry.evidence.series.root_event_id,
                            })}</li>
                          )}
                          {entry.evidence.notifications_suppressed && (
                            <li>{t('notifications_suppressed')}</li>
                          )}
                        </ul>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>

            {loadMoreError && (
              <Alert
                color="danger"
                title={t('load_more_error_title')}
                description={t('load_more_error_description')}
              />
            )}
            {nextCursor && (
              <div className="flex justify-center">
                <Button
                  variant="secondary"
                  isPending={isLoadingMore}
                  onPress={() => void loadMore()}
                >
                  {isLoadingMore ? t('loading_more') : t('load_more')}
                </Button>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
