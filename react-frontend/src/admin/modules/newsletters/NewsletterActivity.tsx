import { getFormattingLocale } from '@/lib/helpers';
import { CardBody, Card, Button, Chip, Tabs, Tab, Skeleton, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Pagination } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Newsletter Activity & Engagement
 * Tabbed page showing:
 *  - Activity Log (all opens/clicks chronologically)
 *  - Who Opened (per-subscriber openers list)
 *  - Who Clicked (per-subscriber clickers list)
 *  - Non-Openers (recipients who never opened)
 *  - Opened, No Click (opened but didn't click)
 */

import { useState, useCallback, useEffect, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import Eye from 'lucide-react/icons/eye';
import MousePointer from 'lucide-react/icons/mouse-pointer';
import Activity from 'lucide-react/icons/activity';
import Inbox from 'lucide-react/icons/inbox';
import Users from 'lucide-react/icons/users';
import UserX from 'lucide-react/icons/user-x';
import UserCheck from 'lucide-react/icons/user-check';
import Download from 'lucide-react/icons/download';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { adminNewsletters } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';

// ─── Types ──────────────────────────────────────────────────────────────────

type ViewTab = 'activity' | 'openers' | 'clickers' | 'non-openers' | 'opened-no-click';

interface ActivityEvent {
  id: number;
  email: string;
  action_type: 'open' | 'click';
  url: string | null;
  action_at: string;
  user_agent: string | null;
  ip_address: string | null;
}

interface OpenerRow {
  id: string;
  email: string;
  first_opened: string;
  open_count: number;
}

interface ClickerRow {
  id: string;
  email: string;
  first_clicked: string;
  click_count: number;
  unique_links: number;
}

interface NonOpenerRow {
  id: string;
  email: string;
  name: string | null;
  sent_at: string;
}

interface OpenedNoClickRow {
  id: string;
  email: string;
  name: string | null;
  first_opened: string;
  open_count: number;
}

interface PaginatedResponse<T> {
  data: T[];
  meta?: {
    total?: number;
    page?: number;
    per_page?: number;
    total_pages?: number;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTime(dateStr: string): string {
  if (!dateStr) return '--';
  return new Date(dateStr).toLocaleDateString(getFormattingLocale(), {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function truncateUA(ua: string | null, maxLen = 60): string {
  if (!ua) return '--';
  return ua.length > maxLen ? ua.substring(0, maxLen) + '...' : ua;
}

function parsePaginated<T>(raw: unknown): PaginatedResponse<T> {
  if (raw && typeof raw === 'object' && 'data' in raw) {
    return raw as PaginatedResponse<T>;
  }
  if (Array.isArray(raw)) {
    return { data: raw as T[] };
  }
  return { data: [] };
}

// The per-subscriber list endpoints (openers/clickers/non-openers/opened-no-click)
// key their rows by email and do not return an `id`. HeroUI's dynamic
// <TableBody items={...}> collection derives each row key from `item.id`/`item.key`
// (the JSX `key` is ignored in dynamic mode) and throws "Could not determine key
// for item" when neither is present — which crashes the whole tab. Each list is
// deduplicated by email server-side, so email is a safe stable key. The activity
// tab is exempt: it already carries a unique numeric id and its emails can repeat.
function withRowId<T extends { email: string }>(rows: T[]): (T & { id: string })[] {
  return rows.filter((row) => !!row.email).map((row) => ({ ...row, id: row.email }));
}

function escapeCsvField(field: string): string {
  let s = (field ?? '').replace(/"/g, '""');
  // Prefix formula-triggering characters to prevent CSV injection
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s}"`;
}

function downloadCsv(rows: string[][], filename: string) {
  const csv = rows.map((r) => r.map(escapeCsvField).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ──────────────────────────────────────────────────────────────

export function NewsletterActivity() {
  const { t } = useTranslation('admin_newsletters');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const toast = useToast();
  usePageTitle(t('newsletters.page_title'));

  const [activeTab, setActiveTab] = useState<ViewTab>('activity');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const perPage = 50;

  // Data states per tab
  const [activityFilter, setActivityFilter] = useState<'all' | 'open' | 'click'>('all');
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [openers, setOpeners] = useState<OpenerRow[]>([]);
  const [clickers, setClickers] = useState<ClickerRow[]>([]);
  const [nonOpeners, setNonOpeners] = useState<NonOpenerRow[]>([]);
  const [openedNoClick, setOpenedNoClick] = useState<OpenedNoClickRow[]>([]);

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const nid = Number(id);
      if (activeTab === 'activity') {
        const params: { page: number; per_page: number; type?: string } = { page, per_page: perPage };
        if (activityFilter !== 'all') params.type = activityFilter;
        const res = await adminNewsletters.getActivity(nid, params);
        if (res.success && res.data) {
          const payload = parsePaginated<ActivityEvent>(res.data);
          setActivityEvents(payload.data);
          setTotalPages(payload.meta?.total_pages ?? 1);
          setTotalCount(payload.meta?.total ?? payload.data.length);
        }
      } else if (activeTab === 'openers') {
        const res = await adminNewsletters.getOpeners(nid, { page, per_page: perPage });
        if (res.success && res.data) {
          const payload = parsePaginated<OpenerRow>(res.data);
          setOpeners(withRowId(payload.data));
          setTotalPages(payload.meta?.total_pages ?? 1);
          setTotalCount(payload.meta?.total ?? payload.data.length);
        }
      } else if (activeTab === 'clickers') {
        const res = await adminNewsletters.getClickers(nid, { page, per_page: perPage });
        if (res.success && res.data) {
          const payload = parsePaginated<ClickerRow>(res.data);
          setClickers(withRowId(payload.data));
          setTotalPages(payload.meta?.total_pages ?? 1);
          setTotalCount(payload.meta?.total ?? payload.data.length);
        }
      } else if (activeTab === 'non-openers') {
        const res = await adminNewsletters.getNonOpeners(nid, { page, per_page: perPage });
        if (res.success && res.data) {
          const payload = parsePaginated<NonOpenerRow>(res.data);
          setNonOpeners(withRowId(payload.data));
          setTotalPages(payload.meta?.total_pages ?? 1);
          setTotalCount(payload.meta?.total ?? payload.data.length);
        }
      } else if (activeTab === 'opened-no-click') {
        const res = await adminNewsletters.getOpenersNoClick(nid, { page, per_page: perPage });
        if (res.success && res.data) {
          const payload = parsePaginated<OpenedNoClickRow>(res.data);
          setOpenedNoClick(withRowId(payload.data));
          setTotalPages(payload.meta?.total_pages ?? 1);
          setTotalCount(payload.meta?.total ?? payload.data.length);
        }
      }
    } catch {
      toast.error(t('newsletter_activity.failed_to_load_data'));
    }
    setLoading(false);
  }, [id, activeTab, page, activityFilter, toast, t])


  useEffect(() => { loadData(); }, [loadData]);

  // Reset page on tab/filter change
  useEffect(() => { setPage(1); }, [activeTab, activityFilter]);

  const handleExport = () => {
    if (activeTab === 'openers') {
      downloadCsv(
        [[t('newsletter_activity.col_email'), t('newsletter_activity.col_first_opened'), t('newsletter_activity.col_open_count')], ...openers.map((r) => [r.email, r.first_opened, String(r.open_count)])],
        `newsletter-${id}-openers.csv`,
      );
    } else if (activeTab === 'clickers') {
      downloadCsv(
        [[t('newsletter_activity.col_email'), t('newsletter_activity.col_first_clicked'), t('newsletter_activity.col_click_count'), t('newsletter_activity.col_unique_links')], ...clickers.map((r) => [r.email, r.first_clicked, String(r.click_count), String(r.unique_links)])],
        `newsletter-${id}-clickers.csv`,
      );
    } else if (activeTab === 'non-openers') {
      downloadCsv(
        [[t('newsletter_activity.col_email'), t('newsletter_activity.col_name'), t('newsletter_activity.col_sent_at')], ...nonOpeners.map((r) => [r.email, r.name ?? '', r.sent_at])],
        `newsletter-${id}-non-openers.csv`,
      );
    } else if (activeTab === 'opened-no-click') {
      downloadCsv(
        [[t('newsletter_activity.col_email'), t('newsletter_activity.col_name'), t('newsletter_activity.col_first_opened'), t('newsletter_activity.col_open_count')], ...openedNoClick.map((r) => [r.email, r.name ?? '', r.first_opened, String(r.open_count)])],
        `newsletter-${id}-opened-no-click.csv`,
      );
    }
  };

  const backPath = tenantPath(`/admin/newsletters/${id}/stats`);
  const showExport = activeTab !== 'activity';
  const currentData = activeTab === 'activity' ? activityEvents
    : activeTab === 'openers' ? openers
    : activeTab === 'clickers' ? clickers
    : activeTab === 'non-openers' ? nonOpeners
    : openedNoClick;

  return (
    <div>
      <PageHeader
        title={t('newsletter_activity.title')}
        description={totalCount > 0 ? t('newsletter_activity.total_records', { count: totalCount }) : undefined}
        actions={
          <div className="flex gap-2">
            {showExport && currentData.length > 0 && (
              <Button
                variant="secondary"
                startContent={<Download size={16} />}
                onPress={handleExport}
              >
                {t('newsletters.export_csv')}
              </Button>
            )}
            <Button
              variant="tertiary"
              startContent={<ArrowLeft size={16} />}
              onPress={() => navigate(backPath)}
            >
              {t('newsletter_activity.back_to_stats')}
            </Button>
          </div>
        }
      />

      <Card>
        <CardBody className="space-y-4 p-5">
          {/* Main Tabs */}
          <Tabs
            selectedKey={activeTab}
            onSelectionChange={(key) => setActiveTab(key as ViewTab)}
            aria-label={t('newsletter_activity.engagement')}
            variant="underlined"
            classNames={{ tabList: 'flex-wrap' }}
          >
            <Tab
              key="activity"
              title={
                <div className="flex items-center gap-2">
                  <Activity size={16} />
                  <span>{t('newsletters.activity_log')}</span>
                </div>
              }
            />
            <Tab
              key="openers"
              title={
                <div className="flex items-center gap-2">
                  <Eye size={16} />
                  <span>{t('newsletter_activity.who_opened')}</span>
                </div>
              }
            />
            <Tab
              key="clickers"
              title={
                <div className="flex items-center gap-2">
                  <MousePointer size={16} />
                  <span>{t('newsletter_activity.who_clicked')}</span>
                </div>
              }
            />
            <Tab
              key="non-openers"
              title={
                <div className="flex items-center gap-2">
                  <UserX size={16} />
                  <span>{t('newsletter_activity.non_openers')}</span>
                </div>
              }
            />
            <Tab
              key="opened-no-click"
              title={
                <div className="flex items-center gap-2">
                  <UserCheck size={16} />
                  <span>{t('newsletter_activity.opened_no_click')}</span>
                </div>
              }
            />
          </Tabs>

          {/* Activity sub-filter */}
          {activeTab === 'activity' && (
            <div className="flex gap-2">
              {(['all', 'open', 'click'] as const).map((f) => (
                <Chip
                  key={f}
                  size="sm"
                  variant="soft"
                  color={f === 'open' ? 'accent' : f === 'click' ? 'success' : 'default'}
                  className="cursor-pointer"
                  onClick={() => setActivityFilter(f)}
                >
                  {f === 'all' ? t('newsletter_activity.all_events') : f === 'open' ? t('newsletter_activity.opens_only') : t('newsletter_activity.clicks_only')}
                </Chip>
              ))}
            </div>
          )}

          {/* Loading skeleton */}
          {loading && currentData.length === 0 && (
            <Skeleton className="h-64 w-full rounded-xl" />
          )}

          {/* ── Activity Log Table ── */}
          {activeTab === 'activity' && !loading && (
            <Table
              aria-label={t('newsletters.activity_log')}
              isStriped
              classNames={{ th: 'text-muted text-xs uppercase' }}
            >
              <TableHeader>
                <TableColumn>{t('newsletter_activity.col_email')}</TableColumn>
                <TableColumn>{t('newsletter_activity.col_event')}</TableColumn>
                <TableColumn>{t('newsletter_activity.col_url')}</TableColumn>
                <TableColumn>{t('newsletter_activity.col_time')}</TableColumn>
                <TableColumn>{t('newsletter_activity.col_user_agent')}</TableColumn>
                <TableColumn>{t('newsletter_activity.col_ip')}</TableColumn>
              </TableHeader>
              <TableBody
                items={activityEvents}
                emptyContent={
                  <EmptyState title={t('shared.no_data_available')} message={t('newsletter_activity.no_events_found')} />
                }
              >
                {(event) => (
                  <TableRow key={event.id}>
                    <TableCell><span className="font-mono text-sm">{event.email}</span></TableCell>
                    <TableCell>
                      <Chip
                        size="sm"
                        color={event.action_type === 'open' ? 'accent' : 'success'}
                        variant="soft"
                        startContent={event.action_type === 'open' ? <Eye size={12} /> : <MousePointer size={12} />}
                      >
                        {event.action_type === 'open' ? t('newsletters.action_opened') : t('newsletters.action_clicked')}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      {event.url ? (
                        <a href={event.url} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-accent hover:underline">
                          {event.url.length > 60 ? event.url.substring(0, 60) + '...' : event.url}
                        </a>
                      ) : <span className="text-sm text-muted">--</span>}
                    </TableCell>
                    <TableCell><span className="text-sm text-foreground">{formatTime(event.action_at)}</span></TableCell>
                    <TableCell><span className="text-xs text-muted" title={event.user_agent ?? undefined}>{truncateUA(event.user_agent)}</span></TableCell>
                    <TableCell><span className="font-mono text-xs text-muted">{event.ip_address ?? '--'}</span></TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}

          {/* ── Openers Table ── */}
          {activeTab === 'openers' && !loading && (
            <Table
              aria-label={t('newsletter_activity.openers')}
              isStriped
              classNames={{ th: 'text-muted text-xs uppercase' }}
            >
              <TableHeader>
                <TableColumn>{t('newsletter_activity.col_email')}</TableColumn>
                <TableColumn align="center">{t('newsletter_activity.col_open_count')}</TableColumn>
                <TableColumn>{t('newsletter_activity.col_first_opened')}</TableColumn>
              </TableHeader>
              <TableBody
                items={openers}
                emptyContent={<EmptyState title={t('shared.no_data_available')} message={t('newsletter_activity.no_openers_found')} />}
              >
                {(row) => (
                  <TableRow key={row.id}>
                    <TableCell><span className="font-mono text-sm">{row.email}</span></TableCell>
                    <TableCell>
                      <div className="text-center">
                        <Chip size="sm" variant="soft" color="accent">{row.open_count}</Chip>
                      </div>
                    </TableCell>
                    <TableCell><span className="text-sm text-foreground">{formatTime(row.first_opened)}</span></TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}

          {/* ── Clickers Table ── */}
          {activeTab === 'clickers' && !loading && (
            <Table
              aria-label={t('newsletter_activity.clickers')}
              isStriped
              classNames={{ th: 'text-muted text-xs uppercase' }}
            >
              <TableHeader>
                <TableColumn>{t('newsletter_activity.col_email')}</TableColumn>
                <TableColumn align="center">{t('newsletter_activity.col_click_count')}</TableColumn>
                <TableColumn align="center">{t('newsletter_activity.col_unique_links')}</TableColumn>
                <TableColumn>{t('newsletter_activity.col_first_clicked')}</TableColumn>
              </TableHeader>
              <TableBody
                items={clickers}
                emptyContent={<EmptyState title={t('shared.no_data_available')} message={t('newsletter_activity.no_clickers_found')} />}
              >
                {(row) => (
                  <TableRow key={row.id}>
                    <TableCell><span className="font-mono text-sm">{row.email}</span></TableCell>
                    <TableCell>
                      <div className="text-center">
                        <Chip size="sm" variant="soft" color="success">{row.click_count}</Chip>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-center">
                        <span className="text-sm text-foreground">{row.unique_links}</span>
                      </div>
                    </TableCell>
                    <TableCell><span className="text-sm text-foreground">{formatTime(row.first_clicked)}</span></TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}

          {/* ── Non-Openers Table ── */}
          {activeTab === 'non-openers' && !loading && (
            <Table
              aria-label={t('newsletter_activity.non_openers')}
              isStriped
              classNames={{ th: 'text-muted text-xs uppercase' }}
            >
              <TableHeader>
                <TableColumn>{t('newsletter_activity.col_email')}</TableColumn>
                <TableColumn>{t('newsletter_activity.col_name')}</TableColumn>
                <TableColumn>{t('newsletter_activity.col_sent_at')}</TableColumn>
              </TableHeader>
              <TableBody
                items={nonOpeners}
                emptyContent={<EmptyState title={t('newsletter_activity.all_recipients_opened_title')} message={t('newsletter_activity.all_recipients_opened')} icon={<Users size={48} className="text-success-300" />} />}
              >
                {(row) => (
                  <TableRow key={row.id}>
                    <TableCell><span className="font-mono text-sm">{row.email}</span></TableCell>
                    <TableCell><span className="text-sm text-foreground">{row.name || '--'}</span></TableCell>
                    <TableCell><span className="text-sm text-foreground">{formatTime(row.sent_at)}</span></TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}

          {/* ── Opened No Click Table ── */}
          {activeTab === 'opened-no-click' && !loading && (
            <Table
              aria-label={t('newsletter_activity.opened_no_click')}
              isStriped
              classNames={{ th: 'text-muted text-xs uppercase' }}
            >
              <TableHeader>
                <TableColumn>{t('newsletter_activity.col_email')}</TableColumn>
                <TableColumn>{t('newsletter_activity.col_name')}</TableColumn>
                <TableColumn align="center">{t('newsletter_activity.col_open_count')}</TableColumn>
                <TableColumn>{t('newsletter_activity.col_first_opened')}</TableColumn>
              </TableHeader>
              <TableBody
                items={openedNoClick}
                emptyContent={<EmptyState title={t('newsletter_activity.all_openers_clicked_title')} message={t('newsletter_activity.all_openers_clicked')} icon={<MousePointer size={48} className="text-success-300" />} />}
              >
                {(row) => (
                  <TableRow key={row.id}>
                    <TableCell><span className="font-mono text-sm">{row.email}</span></TableCell>
                    <TableCell><span className="text-sm text-foreground">{row.name || '--'}</span></TableCell>
                    <TableCell>
                      <div className="text-center">
                        <Chip size="sm" variant="soft" color="accent">{row.open_count}</Chip>
                      </div>
                    </TableCell>
                    <TableCell><span className="text-sm text-foreground">{formatTime(row.first_opened)}</span></TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center pt-2">
              <Pagination
                total={totalPages}
                page={page}
                onChange={setPage}
                showControls
              />
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ─── Sub-Components ─────────────────────────────────────────────────────────

function EmptyState({ title, message, icon }: { title: string; message: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      {icon || <Inbox size={48} className="text-muted" />}
      <p className="text-lg font-semibold text-muted">{title}</p>
      <p className="text-sm text-muted">{message}</p>
    </div>
  );
}

export default NewsletterActivity;
