// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "Waiting for you" — the first few items of each broker queue on the
 * dashboard, with the quick decisions available right there:
 *
 * - new members: Approve (with the same confirmation the Members page asks),
 * - routine messages: Mark reviewed (flagged ones only open — a concern is read),
 * - exchanges needing action, member reports, members' support needs not yet
 *   seen, vetting re-checks and proposed matches: Open (they need reading first).
 *
 * Every list is read through its page's own endpoint, so an item here is one
 * that page would show, with the same server-side rules (a broker never sees
 * their own conversations, or reports about themselves). Refreshes itself
 * after any broker action (useBrokerAutoRefresh).
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, useConfirm } from '@/components/ui';
import ArrowRight from 'lucide-react/icons/arrow-right';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import UserCheck from 'lucide-react/icons/user-check';
import Inbox from 'lucide-react/icons/inbox';
import { adminBroker, adminMatching, adminUsers, adminVetting } from '@/admin/api/adminApi';
import type { AdminUser, BrokerMessage, ExchangeRequest, MatchApproval, VettingRecord } from '@/admin/api/types';
import type { MemberSupportNeed } from '@/admin/modules/safeguarding/safeguardingShared';
import { api } from '@/lib/api';
import { useTenant, useToast } from '@/contexts';
import { formatServerDate } from '@/lib/serverTime';
import { resolveUserDisplayName } from '@/lib/helpers';
import { useBrokerAutoRefresh } from '../useBrokerAutoRefresh';

const SHOW = 3;

interface ReportRow {
  id: number;
  target_label?: string | null;
  target_preview?: string | null;
  target_author_name?: string | null;
  created_at?: string;
}

interface Section<T> {
  items: T[];
  total: number;
}

const empty = <T,>(): Section<T> => ({ items: [], total: 0 });

/** Paginated lists put the total in `meta.total`; the vetting list nests it under `meta.pagination`. */
function totalOf(res: { data?: unknown; meta?: unknown }, rows: unknown[]): number {
  const meta = (res.meta ?? {}) as { total?: number; pagination?: { total?: number } };
  if (typeof meta.pagination?.total === 'number') return meta.pagination.total;
  return typeof meta.total === 'number' ? meta.total : rows.length;
}

/** The match approvals list arrives either as the rows (with `meta`) or wrapped once more in `{ data, meta }`. */
function matchRows(res: { success?: boolean; data?: unknown; meta?: unknown } | null): Section<MatchApproval> | null {
  if (!res?.success) return null;
  const payload = res.data as unknown;
  if (Array.isArray(payload)) return { items: payload.slice(0, SHOW), total: totalOf(res, payload) };
  if (payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)) {
    const inner = payload as { data: MatchApproval[]; meta?: { total?: number } };
    return { items: inner.data.slice(0, SHOW), total: inner.meta?.total ?? inner.data.length };
  }
  return null;
}

interface BrokerInboxProps {
  showExchanges: boolean;
  /** Told whether anything is waiting, so the dashboard can lay the panel beside it out. */
  onVisibilityChange?: (visible: boolean) => void;
}

export function BrokerInbox({ showExchanges, onVisibilityChange }: BrokerInboxProps) {
  const { t } = useTranslation('broker');
  const { tenantPath } = useTenant();
  const toast = useToast();
  const confirm = useConfirm();

  const [members, setMembers] = useState<Section<AdminUser>>(empty);
  const [messages, setMessages] = useState<Section<BrokerMessage>>(empty);
  const [exchanges, setExchanges] = useState<Section<ExchangeRequest>>(empty);
  const [reports, setReports] = useState<Section<ReportRow>>(empty);
  const [supportNeeds, setSupportNeeds] = useState<Section<MemberSupportNeed>>(empty);
  const [vetting, setVetting] = useState<Section<VettingRecord>>(empty);
  const [matches, setMatches] = useState<Section<MatchApproval>>(empty);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [m, msg, ex, rep, needs, vet, match] = await Promise.all([
      adminUsers.list({ status: 'pending', limit: SHOW }).catch(() => null),
      adminBroker.getMessages({ filter: 'unreviewed', per_page: SHOW }).catch(() => null),
      showExchanges ? adminBroker.getExchanges({ status: 'needs_action' }).catch(() => null) : Promise.resolve(null),
      api.get<ReportRow[]>(`/v2/admin/reports?status=pending&limit=${SHOW}`).catch(() => null),
      // The support-needs page reads everyone and shows "not yet seen" by
      // default; the same list, the same rule (needs_review), here.
      api.get<MemberSupportNeed[]>('/v2/admin/safeguarding/member-preferences').catch(() => null),
      adminVetting.list({ status: 'review_requested', per_page: SHOW }).catch(() => null),
      showExchanges ? adminMatching.getApprovals({ status: 'pending' }).catch(() => null) : Promise.resolve(null),
    ]);
    if (m?.success && Array.isArray(m.data)) setMembers({ items: m.data.slice(0, SHOW), total: totalOf(m, m.data) });
    if (msg?.success && Array.isArray(msg.data)) setMessages({ items: msg.data.slice(0, SHOW), total: totalOf(msg, msg.data) });
    if (ex?.success && Array.isArray(ex.data)) setExchanges({ items: ex.data.slice(0, SHOW), total: totalOf(ex, ex.data) });
    if (rep?.success && Array.isArray(rep.data)) setReports({ items: rep.data.slice(0, SHOW), total: totalOf(rep, rep.data) });
    if (needs?.success && Array.isArray(needs.data)) {
      const unseen = needs.data.filter((entry) => Boolean(entry.needs_review));
      setSupportNeeds({ items: unseen.slice(0, SHOW), total: unseen.length });
    }
    if (vet?.success && Array.isArray(vet.data)) {
      // The list's filter leaves resolved requests in; only pending ones wait.
      const pending = vet.data.filter((row) => row.review_status === 'pending');
      setVetting({ items: pending.slice(0, SHOW), total: Math.max(totalOf(vet, vet.data), pending.length) });
    }
    const matchSection = matchRows(match);
    if (matchSection) setMatches(matchSection);
  }, [showExchanges]);

  useEffect(() => {
    void load();
  }, [load]);
  useBrokerAutoRefresh(() => void load());

  const approveMember = async (user: AdminUser) => {
    const ok = await confirm({
      title: t('inbox.approve_confirm_title', { name: user.name }),
      body: t('inbox.approve_confirm_body'),
      confirmLabel: t('members.approve'),
      status: 'success',
    });
    if (!ok) return;
    setBusy(`m${user.id}`);
    try {
      const res = await adminUsers.approve(user.id);
      if (res?.success) {
        toast.success(t('inbox.approved', { name: user.name }));
        setMembers((s) => ({ items: s.items.filter((u) => u.id !== user.id), total: Math.max(0, s.total - 1) }));
      } else {
        toast.error(res?.error || t('members.action_failed'));
      }
    } catch {
      toast.error(t('members.action_failed'));
    } finally {
      setBusy(null);
    }
  };

  const reviewMessage = async (item: BrokerMessage) => {
    setBusy(`r${item.id}`);
    try {
      const res = await adminBroker.reviewMessage(item.id);
      if (res?.success) {
        toast.success(t('messages.reviewed_success'));
        setMessages((s) => ({ items: s.items.filter((m) => m.id !== item.id), total: Math.max(0, s.total - 1) }));
      } else {
        toast.error(res?.error || t('messages.review_failed'));
      }
    } catch {
      toast.error(t('messages.review_failed'));
    } finally {
      setBusy(null);
    }
  };

  const open = (path: string, label: string) => (
    <Button as={Link} to={tenantPath(path)} size="sm" variant="tertiary" aria-label={label}>
      {t('inbox.open')}
    </Button>
  );

  const sections: ReactNode[] = [];

  if (members.total > 0) {
    sections.push(
      <InboxSection key="members" title={t('dashboard.pending_members')} total={members.total}
        seeAll={tenantPath('/broker/members?status=pending')}>
        {members.items.map((u) => (
          <InboxRow key={u.id} primary={u.name} secondary={`${u.email} · ${t('inbox.joined', { date: formatServerDate(u.created_at) })}`}>
            <Button
              size="sm"
              color="success"
              variant="flat"
              startContent={<UserCheck size={14} aria-hidden="true" />}
              isLoading={busy === `m${u.id}`}
              onPress={() => void approveMember(u)}
              aria-label={t('members.approve_named', { name: u.name })}
            >
              {t('members.approve')}
            </Button>
          </InboxRow>
        ))}
      </InboxSection>,
    );
  }

  if (messages.total > 0) {
    sections.push(
      <InboxSection key="messages" title={t('dashboard.unreviewed_messages')} total={messages.total}
        seeAll={tenantPath('/broker/messages?status=unreviewed')}>
        {messages.items.map((m) => (
          <InboxRow
            key={m.id}
            primary={t('inbox.message_between', { sender: m.sender_name, receiver: m.receiver_name })}
            secondary={m.message_body ? m.message_body.slice(0, 90) + (m.message_body.length > 90 ? '…' : '') : ''}
          >
            {/* A flagged copy is a concern: it is opened and read, never ticked off from here. */}
            {!m.flagged && (
              <Button
                size="sm"
                color="success"
                variant="flat"
                startContent={<CheckCircle size={14} aria-hidden="true" />}
                isLoading={busy === `r${m.id}`}
                onPress={() => void reviewMessage(m)}
                aria-label={t('inbox.review_named', { sender: m.sender_name })}
              >
                {t('inbox.mark_reviewed')}
              </Button>
            )}
            {open(`/broker/messages/${m.id}?queue=unreviewed`, t('inbox.open_message', { sender: m.sender_name }))}
          </InboxRow>
        ))}
      </InboxSection>,
    );
  }

  if (showExchanges && exchanges.total > 0) {
    sections.push(
      <InboxSection key="exchanges" title={t('dashboard.pending_exchanges')} total={exchanges.total}
        seeAll={tenantPath('/broker/exchanges?status=needs_action')}>
        {exchanges.items.map((e) => (
          <InboxRow
            key={e.id}
            primary={t('inbox.exchange_between', { requester: e.requester_name, provider: e.provider_name })}
            secondary={`${e.listing_title ?? ''} · ${t(`status.${e.status}`, { defaultValue: e.status })}`}
          >
            {open(`/broker/exchanges/${e.id}`, t('inbox.open_exchange', { id: e.id }))}
          </InboxRow>
        ))}
      </InboxSection>,
    );
  }

  if (reports.total > 0) {
    sections.push(
      <InboxSection key="reports" title={t('dashboard.open_reports')} total={reports.total}
        seeAll={tenantPath('/broker/moderation/reports?status=pending')}>
        {reports.items.map((r) => (
          <InboxRow
            key={r.id}
            primary={r.target_preview || r.target_label || t('inbox.report_fallback', { id: r.id })}
            secondary={[r.target_author_name ? t('inbox.report_by', { name: r.target_author_name }) : '', r.created_at ? formatServerDate(r.created_at) : ''].filter(Boolean).join(' · ')}
          >
            {/* The Reports page has no per-report URL yet, so every row opens the pending list. */}
            {open('/broker/moderation/reports?status=pending', t('inbox.open_reports'))}
          </InboxRow>
        ))}
      </InboxSection>,
    );
  }

  if (supportNeeds.total > 0) {
    sections.push(
      <InboxSection key="support-needs" title={t('dashboard.safeguarding_flags')} total={supportNeeds.total}
        seeAll={tenantPath('/broker/safeguarding/support-needs')}>
        {supportNeeds.items.map((entry) => (
          <InboxRow
            key={entry.user_id}
            primary={entry.user_name}
            secondary={[
              entry.options.filter((o) => !o.is_declination).slice(0, 2).map((o) => o.label).join(', '),
              t('inbox.support_need_answered', { date: formatServerDate(entry.consent_given_at) }),
            ].filter(Boolean).join(' · ')}
          >
            {/* The support-needs page focuses one member with ?user=<id>. */}
            {open(`/broker/safeguarding/support-needs?user=${entry.user_id}`, t('inbox.open_support_need', { name: entry.user_name }))}
          </InboxRow>
        ))}
      </InboxSection>,
    );
  }

  if (vetting.total > 0) {
    sections.push(
      <InboxSection key="vetting" title={t('dashboard.vetting_review_requests')} total={vetting.total}
        seeAll={tenantPath('/broker/vetting?status=review_requested')}>
        {vetting.items.map((row) => {
          const name = resolveUserDisplayName(row, row.email);
          return (
            <InboxRow
              key={row.user_id}
              primary={name}
              secondary={t('inbox.vetting_requested', { date: formatServerDate(row.requested_at) })}
            >
              {open('/broker/vetting?status=review_requested', t('inbox.open_vetting', { name }))}
            </InboxRow>
          );
        })}
      </InboxSection>,
    );
  }

  if (showExchanges && matches.total > 0) {
    sections.push(
      <InboxSection key="matches" title={t('inbox.pending_matches')} total={matches.total}
        seeAll={tenantPath('/broker/match-approvals')}>
        {matches.items.map((match) => (
          <InboxRow
            key={match.id}
            primary={t('inbox.match_between', { a: match.user_1_name ?? match.user_a_name, b: match.user_2_name ?? match.user_b_name })}
            secondary={[match.listing_title ?? '', t('inbox.match_score', { score: Math.round(Number(match.match_score) || 0) })].filter(Boolean).join(' · ')}
          >
            {open(`/broker/match-approvals/${match.id}`, t('inbox.open_match', { id: match.id }))}
          </InboxRow>
        ))}
      </InboxSection>,
    );
  }

  const visible = sections.length > 0;
  useEffect(() => {
    onVisibilityChange?.(visible);
  }, [visible, onVisibilityChange]);

  if (!visible) return null;

  return (
    <section aria-labelledby="broker-inbox-title">
      <h2 id="broker-inbox-title" className="mb-4 flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
        <Inbox size={18} className="text-muted" aria-hidden="true" />
        {t('inbox.title')}
      </h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{sections}</div>
    </section>
  );
}

function InboxSection({ title, total, seeAll, children }: { title: string; total: number; seeAll: string; children: ReactNode }) {
  const { t } = useTranslation('broker');
  return (
    <Card className="rounded-2xl border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
      <CardBody className="p-0">
        <div className="flex items-center justify-between gap-3 border-b border-divider/70 px-4 py-3">
          <h3 className="min-w-0 truncate text-sm font-semibold text-foreground">
            {title} <span className="ml-1 tabular-nums text-muted">{total}</span>
          </h3>
          <Link to={seeAll} className="flex shrink-0 items-center gap-1 text-sm font-medium text-accent hover:underline">
            {t('inbox.see_all')}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
        <ul className="divide-y divide-divider/70">{children}</ul>
      </CardBody>
    </Card>
  );
}

function InboxRow({ primary, secondary, children }: { primary: string; secondary: string; children: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-sm font-medium text-foreground">{primary}</p>
        {secondary && <p className="truncate text-xs text-muted">{secondary}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </li>
  );
}
