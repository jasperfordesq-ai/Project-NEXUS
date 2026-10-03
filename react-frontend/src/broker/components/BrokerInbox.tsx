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
 * - exchanges needing action and member reports: Open (they need reading first).
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
import { adminBroker, adminUsers } from '@/admin/api/adminApi';
import type { AdminUser, BrokerMessage, ExchangeRequest } from '@/admin/api/types';
import { api } from '@/lib/api';
import { useTenant, useToast } from '@/contexts';
import { formatServerDate } from '@/lib/serverTime';
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

function totalOf(res: { data?: unknown; meta?: { total?: number } }, rows: unknown[]): number {
  return typeof res.meta?.total === 'number' ? res.meta.total : rows.length;
}

export function BrokerInbox({ showExchanges }: { showExchanges: boolean }) {
  const { t } = useTranslation('broker');
  const { tenantPath } = useTenant();
  const toast = useToast();
  const confirm = useConfirm();

  const [members, setMembers] = useState<Section<AdminUser>>(empty);
  const [messages, setMessages] = useState<Section<BrokerMessage>>(empty);
  const [exchanges, setExchanges] = useState<Section<ExchangeRequest>>(empty);
  const [reports, setReports] = useState<Section<ReportRow>>(empty);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [m, msg, ex, rep] = await Promise.all([
      adminUsers.list({ status: 'pending', limit: SHOW }).catch(() => null),
      adminBroker.getMessages({ filter: 'unreviewed' }).catch(() => null),
      showExchanges ? adminBroker.getExchanges({ status: 'needs_action' }).catch(() => null) : Promise.resolve(null),
      api.get<ReportRow[]>(`/v2/admin/reports?status=pending&limit=${SHOW}`).catch(() => null),
    ]);
    if (m?.success && Array.isArray(m.data)) setMembers({ items: m.data.slice(0, SHOW), total: totalOf(m, m.data) });
    if (msg?.success && Array.isArray(msg.data)) setMessages({ items: msg.data.slice(0, SHOW), total: totalOf(msg, msg.data) });
    if (ex?.success && Array.isArray(ex.data)) setExchanges({ items: ex.data.slice(0, SHOW), total: totalOf(ex, ex.data) });
    if (rep?.success && Array.isArray(rep.data)) setReports({ items: rep.data.slice(0, SHOW), total: totalOf(rep, rep.data) });
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
            {open('/broker/moderation/reports?status=pending', t('inbox.open_reports'))}
          </InboxRow>
        ))}
      </InboxSection>,
    );
  }

  if (sections.length === 0) return null;

  return (
    <section className="mb-8" aria-labelledby="broker-inbox-title">
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
