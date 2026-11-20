// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker Unmet Needs
 *
 * Requests that have waited two weeks with nobody taking them up: no
 * exchange on them and no message about them from another member. Each row
 * says how many members currently have the request among their matches,
 * which tells a coordinator whether the platform found nobody for it or
 * members were shown it and did not respond.
 *
 * The list is worked out from the platform's own records and needs no AI.
 * Where the community has AI on, a coordinator can press a button to have
 * it say what the waiting requests have in common. Nothing is sent until
 * the button is pressed, and what is sent carries no names.
 */

import { useState, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import AlertCircle from 'lucide-react/icons/circle-alert';
import HeartHandshake from 'lucide-react/icons/heart-handshake';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Sparkles from 'lucide-react/icons/sparkles';
import SearchX from 'lucide-react/icons/search-x';

import { usePageTitle } from '@/hooks';
import { useTenant } from '@/contexts';
import { adminMatching } from '@/admin/api/adminApi';
import { DataTable, type Column } from '@/admin/components';
import type { UnmetNeed, UnmetNeedsPage as UnmetNeedsData, UnmetNeedsAiSummary } from '@/admin/api/types';
import { Button, Card, CardBody, Chip } from '@/components/ui';
import { BrokerPageShell, BrokerEmptyState, BrokerSkeleton } from '../components';
import { MemberName } from '../BrokerMemberWindow';
import { useBrokerAutoRefresh } from '../useBrokerAutoRefresh';

export function UnmetNeedsPage() {
  const { t } = useTranslation('broker');
  usePageTitle(t('nav.unmet_needs'));
  const { tenantPath } = useTenant();

  const [data, setData] = useState<UnmetNeedsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [aiSummary, setAiSummary] = useState<UnmetNeedsAiSummary | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiFailed, setAiFailed] = useState(false);

  // A quiet load (tab focus, the interval) keeps the rows on screen. A failed
  // load is shown as a failure, never as "nothing waiting".
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await adminMatching.getUnmetNeeds();
      if (res.success && res.data && Array.isArray(res.data.items)) {
        setData(res.data);
        setLoadError(false);
      } else if (!quiet) {
        setLoadError(true);
      }
    } catch {
      if (!quiet) setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useBrokerAutoRefresh(() => {
    void load(true);
  });

  const askAi = async () => {
    setAiLoading(true);
    setAiFailed(false);
    try {
      const res = await adminMatching.summariseUnmetNeeds();
      if (res.success && res.data) {
        setAiSummary(res.data);
      } else {
        setAiFailed(true);
      }
    } catch {
      setAiFailed(true);
    } finally {
      setAiLoading(false);
    }
  };

  const waitingDays = data?.waiting_days ?? 14;

  const columns: Column<UnmetNeed>[] = [
    {
      key: 'title',
      label: t('matching.col_listing'),
      render: (item) => (
        <div className="min-w-0 max-w-[360px]">
          <Link
            to={tenantPath(`/listings/${item.id}`)}
            className="block truncate text-sm font-medium text-accent underline-offset-2 hover:underline"
          >
            {item.title}
          </Link>
          {item.description && <p className="truncate text-xs text-muted">{item.description}</p>}
          {item.category_name && <p className="text-xs text-muted">{item.category_name}</p>}
        </div>
      ),
    },
    {
      key: 'requester_name',
      label: t('unmet.col_requested_by'),
      render: (item) => (
        <span className="text-sm text-foreground">
          <MemberName userId={item.requester_id} name={item.requester_name} />
        </span>
      ),
    },
    {
      key: 'days_waiting',
      label: t('unmet.col_waiting'),
      render: (item) => (
        <span className="text-sm tabular-nums text-muted">{t('unmet.days', { number: item.days_waiting })}</span>
      ),
    },
    {
      key: 'matched_members',
      label: t('unmet.col_matched'),
      render: (item) =>
        item.matched_members === 0 ? (
          <Chip size="sm" variant="soft" color="warning">
            {t('unmet.nobody')}
          </Chip>
        ) : (
          <span className="text-sm tabular-nums text-foreground">{item.matched_members}</span>
        ),
    },
  ];

  return (
    <BrokerPageShell
      title={t('nav.unmet_needs')}
      description={t('unmet.description', { days: waitingDays })}
      icon={HeartHandshake}
      color="accent"
      actions={
        <Button
          variant="tertiary"
          size="sm"
          startContent={<RefreshCw size={16} />}
          onPress={() => void load()}
          isLoading={loading}
        >
          {t('matching.refresh')}
        </Button>
      }
    >
      {loading && !data ? (
        <BrokerSkeleton variant="table" />
      ) : loadError && !data ? (
        <BrokerEmptyState
          icon={AlertCircle}
          color="danger"
          title={t('unmet.load_error_title')}
          hint={t('matching.load_error_hint')}
          action={
            <Button size="sm" variant="danger-soft" onPress={() => void load()}>
              {t('matching.retry')}
            </Button>
          }
        />
      ) : data && data.items.length === 0 ? (
        <BrokerEmptyState
          icon={SearchX}
          color="success"
          title={t('unmet.empty_title')}
          hint={t('unmet.empty_hint', { days: waitingDays })}
        />
      ) : data ? (
        <>
          <p className="mb-3 px-1 text-sm text-muted">
            {t('unmet.totals', {
              total: data.summary.total,
              noMatch: data.summary.no_match,
              noResponse: data.summary.no_response,
            })}
          </p>

          {data.ai_available && (
            <Card className="mb-4">
              <CardBody className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    startContent={<Sparkles size={14} />}
                    onPress={() => void askAi()}
                    isLoading={aiLoading}
                  >
                    {t('unmet.ai_button')}
                  </Button>
                  <p className="text-xs text-muted">{t('unmet.ai_note')}</p>
                </div>
                {aiFailed && (
                  <p className="text-sm text-danger" role="alert">
                    {t('unmet.ai_failed')}
                  </p>
                )}
                {aiSummary && !aiFailed && (
                  <div className="space-y-2" aria-live="polite">
                    {aiSummary.summary && <p className="text-sm text-foreground">{aiSummary.summary}</p>}
                    {aiSummary.themes.length > 0 && (
                      <ul className="list-disc space-y-1 ps-5 text-sm">
                        {aiSummary.themes.map((theme) => (
                          <li key={theme.need}>
                            <span className="font-medium text-foreground">
                              {theme.requests > 0 ? `${theme.need} (${theme.requests})` : theme.need}
                            </span>
                            {theme.suggestion && <p className="text-muted">{theme.suggestion}</p>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          <DataTable
            mobileCards
            columns={columns}
            data={data.items}
            isLoading={loading}
            searchable={false}
            onRefresh={() => void load()}
          />
        </>
      ) : null}
    </BrokerPageShell>
  );
}

export default UnmetNeedsPage;
