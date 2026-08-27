import { getFormattingLocale, resolveUserDisplayName } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Button, Spinner, Chip, Select, SelectItem, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/ui';
import { useState, useEffect, useCallback } from 'react';

import ScrollText from 'lucide-react/icons/scroll-text';
import ChevronLeft from 'lucide-react/icons/chevron-left';
import ChevronRight from 'lucide-react/icons/chevron-right';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * VerificationAuditLog — Admin component showing identity verification events.
 */


interface AuditEvent {
  id: number;
  user_id: number;
  session_id: number | null;
  event_type: string;
  actor_type: string;
  actor_id: number | null;
  details: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  user_email: string | null;
}

const EVENT_TYPE_LABELS: Record<string, { color: 'success' | 'danger' | 'warning' | 'primary' | 'default' }> = {
  registration_started: { color: 'primary' },
  verification_created: { color: 'default' },
  verification_started: { color: 'primary' },
  verification_processing: { color: 'warning' },
  verification_passed: { color: 'success' },
  verification_failed: { color: 'danger' },
  verification_expired: { color: 'warning' },
  verification_cancelled: { color: 'default' },
  admin_review_started: { color: 'warning' },
  admin_approved: { color: 'success' },
  admin_rejected: { color: 'danger' },
  account_activated: { color: 'success' },
  fallback_triggered: { color: 'warning' },
};

const EVENT_TYPES = Object.keys(EVENT_TYPE_LABELS);
const PAGE_SIZE = 25;

export function VerificationAuditLog() {
  const { t } = useTranslation('admin_system');
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [filterType, setFilterType] = useState<string>('');

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (filterType) params.set('event_type', filterType);

      const res = await api.get<{ events: AuditEvent[]; total: number }>(
        `/v2/admin/identity/audit-log?${params.toString()}`
      );
      if (res.success && res.data) {
        setEvents(res.data.events || []);
        setTotal(res.data.total || 0);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [page, filterType]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center px-6 pt-5 pb-0">
        <div className="flex items-center gap-2">
          <ScrollText className="w-5 h-5 text-accent" />
          <h3 className="text-lg font-semibold">{t('verification.audit_log_title')}</h3>
          <Chip size="sm" variant="soft">{t('verification.total_events', { count: total })}</Chip>
        </div>
        <div className="flex items-center gap-2">
          <Select
            size="sm"
            aria-label={t('verification.filter_events_aria')}
            placeholder={t('verification.filter_all_events')}
            className="w-48"
            selectedKeys={filterType ? [filterType] : []}
            onSelectionChange={(keys) => {
              const key = Array.from(keys as Set<string>)[0] || '';
              setFilterType(key);
              setPage(0);
            }}
          >
            {EVENT_TYPES.map((type) => (
              <SelectItem key={type} id={type} textValue={t(`verification.event_type_${type}`)}>
                {t(`verification.event_type_${type}`)}
              </SelectItem>
            ))}
          </Select>
          <Button isIconOnly size="sm" variant="tertiary" onPress={fetchEvents} aria-label={t('verification.refresh_aria')}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardBody className="px-6 pb-5">
        {loading ? (
          <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-8">
            <Spinner size="lg" />
          </div>
        ) : events.length === 0 ? (
          <p className="text-center py-8 text-theme-muted">{t('verification.no_events')}</p>
        ) : (
          <>
            <Table aria-label={t('verification.audit_log_aria')} removeWrapper>
              <TableHeader>
                <TableColumn>{t('verification.col_time')}</TableColumn>
                <TableColumn>{t('verification.col_user')}</TableColumn>
                <TableColumn>{t('verification.col_event')}</TableColumn>
                <TableColumn>{t('verification.col_actor')}</TableColumn>
                <TableColumn>{t('verification.col_ip')}</TableColumn>
                <TableColumn>{t('verification.col_details')}</TableColumn>
              </TableHeader>
              <TableBody>
                {events.map((event) => {
                  const typeInfo = EVENT_TYPE_LABELS[event.event_type] || { color: 'default' as const };
                  const typeLabel = t(`verification.event_type_${event.event_type}`);
                  const userName = resolveUserDisplayName(event) || t('verification.user_with_id', { id: event.user_id });
                  let details = '';
                  if (event.details) {
                    try {
                      const parsed = JSON.parse(event.details);
                      details = Object.entries(parsed)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(', ');
                    } catch {
                      details = event.details;
                    }
                  }

                  return (
                    <TableRow key={event.id}>
                      <TableCell className="whitespace-nowrap text-xs text-theme-muted">
                        {new Date(event.created_at).toLocaleString(getFormattingLocale())}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">{userName}</div>
                        {event.user_email && <div className="text-xs text-theme-muted">{event.user_email}</div>}
                      </TableCell>
                      <TableCell>
                        <Chip size="sm" color={typeInfo.color} variant="soft">
                          {typeLabel}
                        </Chip>
                      </TableCell>
                      <TableCell className="text-xs text-theme-muted">
                        {t(`verification.actor_type_${event.actor_type}`, { defaultValue: t('verification.actor_type_unknown') })}
                      </TableCell>
                      <TableCell className="text-xs text-theme-muted font-mono">
                        {event.ip_address || t('verification.empty_value')}
                      </TableCell>
                      <TableCell className="text-xs text-theme-muted max-w-[200px] truncate" title={details}>
                        {details || t('verification.empty_value')}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-between items-center mt-4">
                <span className="text-sm text-theme-muted">
                  {t('verification.page_of', { page: page + 1, total: totalPages })}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="tertiary"
                    isDisabled={page === 0}
                    onPress={() => setPage((p) => p - 1)}
                    startContent={<ChevronLeft className="w-4 h-4" />}
                  >
                    {t('verification.previous')}
                  </Button>
                  <Button
                    size="sm"
                    variant="tertiary"
                    isDisabled={page >= totalPages - 1}
                    onPress={() => setPage((p) => p + 1)}
                    endContent={<ChevronRight className="w-4 h-4" />}
                  >
                    {t('verification.next')}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

export default VerificationAuditLog;
