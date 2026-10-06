// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * OrgOpportunitiesTab — an organisation's own opportunities on its dashboard:
 * open, closed to new volunteers, and cancelled, each with what needs
 * attention (applications waiting, approved volunteers, upcoming shifts).
 *
 * Until 6 Oct 2026 the dashboard had no such tab, so organisers browsed the
 * public list to find their own — where closed and cancelled ones never show.
 *
 * Server contract: GET /v2/volunteering/organisations/{id}/opportunities
 *   → { items: [{ id, title, state: open|closed|cancelled, location, is_remote,
 *                 start_date, end_date, pending_applications, approved_volunteers, upcoming_shifts }] }
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Briefcase from 'lucide-react/icons/briefcase';
import Pencil from 'lucide-react/icons/pencil';
import Plus from 'lucide-react/icons/plus';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';

type OppState = 'open' | 'closed' | 'cancelled';
type Filter = OppState | 'all';

export interface OrgOpportunity {
  id: number;
  title: string;
  state: OppState;
  location: string | null;
  is_remote: boolean;
  start_date: string | null;
  end_date: string | null;
  pending_applications: number;
  approved_volunteers: number;
  upcoming_shifts: number;
}

const FILTERS: Filter[] = ['open', 'closed', 'cancelled', 'all'];

const STATE_COLOR: Record<OppState, 'success' | 'warning' | 'danger'> = {
  open: 'success',
  closed: 'warning',
  cancelled: 'danger',
};

const formatDate = (value: string) =>
  new Date(value.length === 10 ? `${value}T00:00:00` : value.replace(' ', 'T'))
    .toLocaleDateString(getFormattingLocale(), { day: 'numeric', month: 'short', year: 'numeric' });

export function OrgOpportunitiesTab({ orgId }: { orgId: number }) {
  const { t } = useTranslation('volunteering');
  const { tenantPath } = useTenant();
  const [items, setItems] = useState<OrgOpportunity[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('open');

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await api.get<{ items?: OrgOpportunity[] }>(`/v2/volunteering/organisations/${orgId}/opportunities`);
      if (res.success && res.data) {
        setItems(Array.isArray(res.data.items) ? res.data.items : []);
      } else {
        setFailed(true);
        setItems([]);
      }
    } catch (err) {
      logError('Failed to load organisation opportunities', err);
      setFailed(true);
      setItems([]);
    }
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { open: 0, closed: 0, cancelled: 0, all: 0 };
    for (const item of items ?? []) {
      c[item.state] += 1;
      c.all += 1;
    }
    return c;
  }, [items]);

  const visible = (items ?? []).filter((item) => filter === 'all' || item.state === filter);

  return (
    <GlassCard className="p-6 space-y-4" data-testid="org-opportunities-tab">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-theme-primary flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-accent" aria-hidden="true" />
            {t('org_dashboard.opps_heading')}
          </h2>
          <p className="text-sm text-theme-muted mt-1">{t('org_dashboard.opps_intro')}</p>
        </div>
        <Button
          as={Link}
          to={tenantPath('/volunteering/create')}
          size="sm"
          className="bg-gradient-to-r from-rose-500 to-pink-600 text-white sm:flex-shrink-0"
          startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
        >
          {t('org_dashboard.post_opportunity')}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t('org_dashboard.opps_filter_label')}>
        {FILTERS.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'primary' : 'tertiary'}
            aria-pressed={filter === f}
            onPress={() => setFilter(f)}
            data-testid={`org-opps-filter-${f}`}
          >
            {t(`org_dashboard.opps_filter_${f}`, { count: counts[f] })}
          </Button>
        ))}
      </div>

      {items === null && (
        <div className="flex justify-center py-8" role="status" aria-busy="true">
          <Spinner size="sm" />
        </div>
      )}

      {failed && (
        <div className="flex flex-col items-start gap-2" role="alert">
          <p className="text-sm text-danger">{t('org_dashboard.opps_load_error')}</p>
          <Button size="sm" variant="tertiary" startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />} onPress={() => void load()}>
            {t('org_dashboard.opps_retry')}
          </Button>
        </div>
      )}

      {items !== null && !failed && visible.length === 0 && (
        <p className="text-sm text-theme-muted" data-testid="org-opps-empty">
          {filter === 'open' ? t('org_dashboard.opps_empty_open') : t('org_dashboard.opps_empty_other')}
        </p>
      )}

      {visible.length > 0 && (
        <ul className="space-y-2">
          {visible.map((opp) => (
            <li
              key={opp.id}
              data-testid={`org-opp-${opp.id}`}
              className="flex flex-col gap-3 p-3 rounded-xl border border-theme-default bg-theme-elevated sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={tenantPath(`/volunteering/opportunities/${opp.id}`)} className="text-sm font-semibold text-theme-primary hover:underline">
                    {opp.title}
                  </Link>
                  <Chip size="sm" variant="soft" color={STATE_COLOR[opp.state]}>{t(`org_dashboard.opps_state_${opp.state}`)}</Chip>
                </div>
                <p className="text-xs text-theme-subtle">
                  {[
                    opp.is_remote ? t('org_dashboard.opps_remote') : opp.location,
                    opp.start_date ? (opp.end_date ? `${formatDate(opp.start_date)} – ${formatDate(opp.end_date)}` : formatDate(opp.start_date)) : null,
                  ].filter(Boolean).join(' · ')}
                </p>
                {opp.state !== 'cancelled' && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Chip size="sm" variant="soft" color={opp.pending_applications > 0 ? 'warning' : 'default'}>
                      {t('org_dashboard.opps_pending', { count: opp.pending_applications })}
                    </Chip>
                    <Chip size="sm" variant="soft">{t('org_dashboard.opps_approved', { count: opp.approved_volunteers })}</Chip>
                    <Chip size="sm" variant="soft" color={opp.state === 'open' && opp.upcoming_shifts === 0 ? 'warning' : 'default'}>
                      {t('org_dashboard.opps_upcoming_shifts', { count: opp.upcoming_shifts })}
                    </Chip>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2 sm:flex-shrink-0">
                <Button as={Link} to={tenantPath(`/volunteering/opportunities/${opp.id}`)} size="sm" variant="tertiary" data-testid={`org-opp-manage-${opp.id}`}>
                  {t('org_dashboard.opps_manage')}
                </Button>
                {opp.state !== 'cancelled' && (
                  <Button
                    as={Link}
                    to={tenantPath(`/volunteering/opportunities/${opp.id}/edit`)}
                    size="sm"
                    variant="tertiary"
                    startContent={<Pencil className="w-3.5 h-3.5" aria-hidden="true" />}
                  >
                    {t('org_dashboard.opps_edit')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}

export default OrgOpportunitiesTab;
