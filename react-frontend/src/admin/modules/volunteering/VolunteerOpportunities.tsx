// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Opportunities & shifts (admin)
 *
 * Every opportunity in the community, with the shared ShiftManager panel under
 * each one so an admin can add, change or remove its shifts. Until 2026-10-06
 * the admin panel had no opportunity page at all and no screen anywhere could
 * create a shift. Parity: AdminVolunteerController::opportunities() for the
 * list; the shift endpoints are the member ones, which admit community admins.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Briefcase from 'lucide-react/icons/briefcase';
import Building2 from 'lucide-react/icons/building-2';
import CalendarClock from 'lucide-react/icons/calendar-clock';
import ChevronDown from 'lucide-react/icons/chevron-down';
import ChevronUp from 'lucide-react/icons/chevron-up';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Search from 'lucide-react/icons/search';
import { Button, Card, CardBody, Chip, Input } from '@/components/ui';
import { ShiftManager } from '@/components/volunteering/ShiftManager';
import { useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { adminVolunteering, type AdminOpportunityRow } from '../../api/adminApi';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';

const STATUS_COLORS: Record<string, 'success' | 'warning' | 'default' | 'danger'> = {
  open: 'success',
  active: 'success',
  draft: 'warning',
  closed: 'default',
};

const STATUS_KEYS = ['open', 'active', 'closed', 'draft'] as const;
type KnownStatus = (typeof STATUS_KEYS)[number];
const isKnownStatus = (s: string | null): s is KnownStatus => STATUS_KEYS.includes((s ?? '') as KnownStatus);

export function VolunteerOpportunities() {
  const { t } = useTranslation('admin_volunteering');
  usePageTitle(t('volunteering.opportunities_title'));
  const toast = useToast();

  const [rows, setRows] = useState<AdminOpportunityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async (append = false, nextCursor: string | null = null) => {
    const request = ++requestRef.current;
    if (append) setLoadingMore(true); else setLoading(true);
    try {
      const res = await adminVolunteering.getOpportunities({ search: appliedSearch, cursor: nextCursor });
      if (request !== requestRef.current) return;
      if (res.success && Array.isArray(res.data)) {
        setRows((prev) => (append ? [...prev, ...res.data as AdminOpportunityRow[]] : res.data as AdminOpportunityRow[]));
        setHasMore(res.meta?.has_more ?? false);
        setCursor(res.meta?.cursor ?? null);
      } else if (!append) {
        setRows([]);
        toast.error(t('volunteering.failed_to_load_opportunities'));
      }
    } catch {
      if (request !== requestRef.current) return;
      if (!append) setRows([]);
      toast.error(t('volunteering.failed_to_load_opportunities'));
    } finally {
      if (request === requestRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [appliedSearch, toast, t]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('volunteering.opportunities_title')}
        description={t('volunteering.opportunities_desc')}
        icon={<CalendarClock aria-hidden="true" size={22} />}
        actions={
          <Button variant="tertiary" startContent={<RefreshCw aria-hidden="true" size={16} />} onPress={() => { void load(); }} isLoading={loading}>
            {t('volunteering.refresh')}
          </Button>
        }
      />

      <form
        className="max-w-md"
        onSubmit={(e) => { e.preventDefault(); setAppliedSearch(search.trim()); }}
        role="search"
      >
        <Input
          aria-label={t('volunteering.opportunities_search')}
          placeholder={t('volunteering.opportunities_search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => { setSearch(''); setAppliedSearch(''); }}
          isClearable
          startContent={<Search aria-hidden="true" size={16} className="text-muted" />}
          data-testid="admin-opportunities-search"
        />
      </form>

      {!loading && rows.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title={t('volunteering.no_opportunities')}
          description={t('volunteering.no_opportunities_desc')}
        />
      ) : (
        <div className="space-y-3">
          {loading && rows.length === 0 && (
            <div role="status" aria-busy="true" aria-label={t('volunteering.loading')} className="text-muted/80 text-sm">
              {t('volunteering.loading')}
            </div>
          )}
          {rows.map((row) => {
            const expanded = expandedId === row.id;
            const status = isKnownStatus(row.status) ? row.status : null;
            return (
              <Card key={row.id} data-testid={`admin-opportunity-${row.id}`}>
                <CardBody className="space-y-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold truncate">{row.title}</p>
                        {status && (
                          <Chip size="sm" variant="soft" color={STATUS_COLORS[status] ?? 'default'}>
                            {t(`volunteering.opportunity_status_${status}`)}
                          </Chip>
                        )}
                      </div>
                      {row.org_name && (
                        <p className="text-sm text-muted flex items-center gap-1 mt-1">
                          <Building2 aria-hidden="true" size={14} />
                          {row.org_name}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant={expanded ? 'secondary' : 'primary'}
                      startContent={expanded ? <ChevronUp aria-hidden="true" size={16} /> : <ChevronDown aria-hidden="true" size={16} />}
                      onPress={() => setExpandedId(expanded ? null : row.id)}
                      aria-expanded={expanded}
                      data-testid={`admin-opportunity-toggle-${row.id}`}
                    >
                      {expanded ? t('volunteering.hide_shifts') : t('volunteering.manage_shifts')}
                    </Button>
                  </div>
                  {expanded && <ShiftManager opportunityId={row.id} />}
                </CardBody>
              </Card>
            );
          })}
          {hasMore && (
            <div className="pt-2 text-center">
              <Button variant="secondary" isLoading={loadingMore} onPress={() => { void load(true, cursor); }}>
                {t('volunteering.load_more')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default VolunteerOpportunities;
