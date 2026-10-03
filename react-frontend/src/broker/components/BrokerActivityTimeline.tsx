// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BrokerActivityTimeline — the broker dashboard's "Recent Activity" panel:
 * a dot-and-rail list of the latest broker, member, report and moderation
 * actions (activity_log + org_audit_log, see AdminBrokerController::
 * recentBrokerActivity), each with a coloured chip, a plain-English verb,
 * the record it concerned and how long ago it happened.
 *
 * - A row links to its record when the audit details name one: an exchange,
 *   a broker message copy, a listing's risk tag, a match approval. Members
 *   are not linked yet — the Members page has no deep link to one member.
 * - The relative time ("5m ago") carries the exact date and time in a
 *   tooltip, because "3d ago" is not evidence and a broker sometimes needs
 *   the timestamp.
 * - "See all" opens a drawer with the last 100 actions, read through the
 *   same endpoint (`only=activity`), so no second route is needed.
 *
 * Extracted from BrokerDashboardPage in October 2026 so the page reads as a
 * layout and this file as the feed.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Activity from 'lucide-react/icons/activity';
import AlertCircle from 'lucide-react/icons/circle-alert';
import { Button, Chip, Drawer, DrawerBody, DrawerContent, DrawerHeader, Tooltip } from '@/components/ui';
import { DrawerHeading } from '@/components/ui/Drawer';
import { useTenant } from '@/contexts';
import { adminBroker } from '@/admin/api/adminApi';
import { getFormattingLocale, resolveUserDisplayName } from '@/lib/helpers';
import { formatServerDateTime, parseServerTimestamp } from '@/lib/serverTime';
import type { BrokerDashboardActivityEntry, BrokerDashboardExtras } from '../dashboardTypes';
import { BrokerEmptyState } from './BrokerEmptyState';
import { BrokerSectionCard } from './BrokerSectionCard';
import { BrokerSkeleton } from './BrokerSkeleton';

/** How many rows the "See all" drawer asks for — the endpoint's maximum. */
export const ACTIVITY_DRAWER_LIMIT = 100;

type ChipColor = 'success' | 'danger' | 'accent' | 'warning' | 'default';

const timelineDotClass: Record<ChipColor, string> = {
  success: 'bg-success',
  danger: 'bg-danger',
  accent: 'bg-accent',
  warning: 'bg-warning',
  default: 'bg-muted/60',
};

// Action keys MUST match the action strings emitted by the backend dashboard
// query in AdminBrokerController::recentBrokerActivity (UNION of activity_log
// + org_audit_log). Any mismatch causes the row to render with a default-grey
// chip and a readable snake_case fallback label.
const actionChipColorMap: Record<string, ChipColor> = {
  // org_audit_log entries (broker controller writes via AuditLogService::log)
  exchange_approved: 'success',
  exchange_rejected: 'danger',
  exchange_dispute_resolved: 'success',
  exchange_dispute_cancelled: 'default',
  exchange_reversed: 'danger',
  match_approved: 'success',
  match_rejected: 'danger',
  member_balance_adjusted: 'accent',
  broker_message_reviewed: 'accent',
  broker_message_approved: 'success',
  broker_message_flagged: 'warning',
  listing_risk_tag_created: 'warning',
  listing_risk_tag_updated: 'warning',
  listing_risk_tag_removed: 'default',
  user_monitoring_added: 'default',
  user_monitoring_removed: 'default',
  broker_config_updated: 'accent',
  // activity_log entries (insurance, members, reports and moderation write via ActivityLog::log)
  insurance_cert_created: 'accent',
  insurance_cert_updated: 'accent',
  insurance_cert_verified: 'success',
  insurance_cert_rejected: 'danger',
  insurance_cert_deleted: 'default',
  admin_approve_user: 'success',
  admin_reject_user: 'danger',
  admin_suspend_user: 'danger',
  admin_reactivate_user: 'success',
  resolve_report: 'success',
  dismiss_report: 'default',
  hide_comment: 'warning',
  delete_comment: 'danger',
  flag_review: 'warning',
  hide_review: 'warning',
  delete_review: 'danger',
  hide_feed_item: 'warning',
  delete_feed_item: 'danger',
};

// Action keys → broker.json sub-key suffix. The full path is
// `dashboard.activity.chip_${suffix}` and `dashboard.activity.verb_${suffix}`.
// Mapping is needed because the backend emits keys like
// 'broker_message_reviewed' but i18n keys are kept short ('message_reviewed').
const actionI18nKeySuffix: Record<string, string> = {
  exchange_approved: 'exchange_approved',
  exchange_rejected: 'exchange_rejected',
  exchange_dispute_resolved: 'dispute_resolved',
  exchange_dispute_cancelled: 'dispute_cancelled',
  exchange_reversed: 'exchange_reversed',
  match_approved: 'match_approved',
  match_rejected: 'match_rejected',
  member_balance_adjusted: 'balance_adjusted',
  broker_message_reviewed: 'message_reviewed',
  broker_message_approved: 'message_approved',
  broker_message_flagged: 'message_flagged',
  listing_risk_tag_created: 'risk_tag_created',
  listing_risk_tag_updated: 'risk_tag_updated',
  listing_risk_tag_removed: 'risk_tag_removed',
  user_monitoring_added: 'monitoring_added',
  user_monitoring_removed: 'monitoring_removed',
  broker_config_updated: 'config_updated',
  insurance_cert_created: 'insurance_created',
  insurance_cert_updated: 'insurance_updated',
  insurance_cert_verified: 'insurance_verified',
  insurance_cert_rejected: 'insurance_rejected',
  insurance_cert_deleted: 'insurance_deleted',
  admin_approve_user: 'member_approved',
  admin_reject_user: 'member_rejected',
  admin_suspend_user: 'member_suspended',
  admin_reactivate_user: 'member_reactivated',
  resolve_report: 'report_resolved',
  dismiss_report: 'report_dismissed',
  hide_comment: 'comment_hidden',
  delete_comment: 'comment_deleted',
  flag_review: 'review_flagged',
  hide_review: 'review_hidden',
  delete_review: 'review_deleted',
  hide_feed_item: 'post_hidden',
  delete_feed_item: 'post_deleted',
};

export function ActivityChip({ actionType }: { actionType: string }) {
  const { t } = useTranslation('broker');
  const color: ChipColor = actionChipColorMap[actionType] ?? 'default';
  const suffix = actionI18nKeySuffix[actionType];
  const label = suffix
    ? t(`dashboard.activity.chip_${suffix}`)
    : actionType.replace(/_/g, ' ');
  return (
    <Chip size="sm" variant="tertiary" color={color} className="shrink-0">
      {label}
    </Chip>
  );
}

export type TFunc = (key: string, options?: Record<string, unknown>) => string;

export function formatActionLabel(actionType: string, t: TFunc): string {
  const suffix = actionI18nKeySuffix[actionType];
  return suffix
    ? t(`dashboard.activity.verb_${suffix}`)
    : actionType.replace(/_/g, ' ');
}

/** The audit details as an object, or null when they are not JSON. */
function parseDetails(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function idIn(data: Record<string, unknown>, key: string): string | null {
  const v = data[key];
  return typeof v === 'number' || (typeof v === 'string' && v !== '') ? String(v) : null;
}

/**
 * Turn an audit entry's `details` into words a broker can read.
 *
 * org_audit_log rows carry a JSON object written by the controller
 * (`{"updated_keys":[…],"actor_role":"admin"}`); until October 2026 that JSON
 * was printed on the dashboard as-is. activity_log rows (insurance, members,
 * reports, moderation) carry a plain sentence and pass straight through.
 * Anything unparseable is hidden rather than dumped — the chip and verb above
 * it still say what happened.
 */
export function formatActivityDetails(raw: string | null | undefined, t: TFunc): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;
  if (!text.startsWith('{')) return text;

  const data = parseDetails(text);
  if (!data) return null;

  const idOf = (key: string) => idIn(data, key);
  const levelLabel = (level: string) => t(`risk_tags.level_${level}`, { defaultValue: level });
  const parts: string[] = [];

  // A save that changed nothing still writes an audit row with an empty list;
  // "0 settings changed" told the broker nothing, so the chip and verb carry it.
  if (Array.isArray(data.updated_keys) && data.updated_keys.length > 0) {
    parts.push(t('dashboard.activity.detail_settings_changed', { count: data.updated_keys.length }));
  }
  const exchangeId = idOf('exchange_id');
  if (exchangeId) parts.push(t('dashboard.activity.detail_exchange', { id: exchangeId }));
  const approvalId = idOf('approval_id');
  if (approvalId) parts.push(t('dashboard.activity.detail_match', { id: approvalId }));
  const messageId = idOf('message_id');
  if (messageId) parts.push(t('dashboard.activity.detail_message', { id: messageId }));
  if (data.has_notes === true) parts.push(t('dashboard.activity.detail_with_notes'));
  const listingId = idOf('listing_id');
  if (listingId) parts.push(t('dashboard.activity.detail_listing', { id: listingId }));
  const level = data.new_risk_level ?? data.risk_level;
  if (typeof level === 'string' && level) {
    parts.push(t('dashboard.activity.detail_risk_level', { level: levelLabel(level) }));
  }
  if (typeof data.previous_risk_level === 'string' && data.previous_risk_level) {
    parts.push(t('dashboard.activity.detail_was_risk_level', { level: levelLabel(data.previous_risk_level) }));
  }
  const finalHours = idOf('final_hours');
  if (finalHours) parts.push(t('dashboard.activity.detail_final_hours', { hours: finalHours }));
  const adjustment = idOf('adjustment');
  if (adjustment) parts.push(t('dashboard.activity.detail_adjustment', { amount: adjustment }));
  if (typeof data.user_name === 'string' && data.user_name.trim()) {
    parts.push(data.user_name.trim());
  } else {
    const userId = idOf('user_id');
    if (userId) parts.push(t('dashboard.activity.detail_member', { id: userId }));
  }
  if (typeof data.reason === 'string' && data.reason.trim()) parts.push(data.reason.trim());
  if (typeof data.notes === 'string' && data.notes.trim()) parts.push(data.notes.trim());

  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * The broker-panel page for the record an entry concerns, or null. Members are
 * deliberately not linked: the Members page cannot yet open one member by URL.
 */
export function activityLinkFor(entry: BrokerDashboardActivityEntry): string | null {
  const data = parseDetails(entry.details);
  if (!data) return null;
  const exchangeId = idIn(data, 'exchange_id');
  if (exchangeId) return `/broker/exchanges/${exchangeId}`;
  const approvalId = idIn(data, 'approval_id');
  if (approvalId) return `/broker/match-approvals/${approvalId}`;
  const messageId = idIn(data, 'message_id');
  if (messageId) return `/broker/messages/${messageId}`;
  if (idIn(data, 'listing_id')) return '/broker/risk-tags';
  return null;
}

export function formatTimeAgo(dateStr: string, t: TFunc): string {
  const date = parseServerTimestamp(dateStr);
  if (!date) return '';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  // Clock skew between server and client can produce a negative diff.
  // Clamp to 0 so the user doesn't see "in the future" labels on rows
  // that just happened.
  const diffMins = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMins < 1) return t('dashboard.time_just_now');
  if (diffMins < 60) return t('dashboard.time_minutes_ago', { count: diffMins });
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return t('dashboard.time_hours_ago', { count: diffHrs });
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return t('dashboard.time_days_ago', { count: diffDays });
  return date.toLocaleDateString(getFormattingLocale());
}

/** "5m ago" with the exact date and time one hover or focus away. */
function TimeAgo({ createdAt }: { createdAt: string }) {
  const { t } = useTranslation('broker');
  const iso = parseServerTimestamp(createdAt)?.toISOString();
  return (
    <Tooltip content={formatServerDateTime(createdAt)} placement="top">
      <Button
        variant="tertiary"
        size="sm"
        className="h-auto min-w-0 shrink-0 px-1 py-0.5 text-xs font-normal tabular-nums text-muted"
      >
        <time dateTime={iso}>{formatTimeAgo(createdAt, t)}</time>
      </Button>
    </Tooltip>
  );
}

/** The rows alone — the panel and the drawer both render this. */
export function ActivityList({ entries }: { entries: BrokerDashboardActivityEntry[] }) {
  const { t } = useTranslation('broker');
  const { tenantPath } = useTenant();
  return (
    <ul className="px-4 py-2">
      {entries.map((entry, idx) => {
        // Composite key: ids collide between activity_log and org_audit_log,
        // so the source tag from the controller is load-bearing here. Falling
        // back to action_type+id keeps older API responses (pre-source) from
        // breaking.
        const rowKey = `${entry.source ?? entry.action_type}-${entry.id}`;
        const fullName = resolveUserDisplayName(entry);
        const actorName = fullName || t('dashboard.deleted_user');
        const isLast = idx === entries.length - 1;
        const dotColor = actionChipColorMap[entry.action_type] ?? 'default';
        const detailText = formatActivityDetails(entry.details, t);
        const target = activityLinkFor(entry);
        const text = (
          <>
            <p className="text-sm text-foreground">
              <span className="font-medium">{actorName}</span>{' '}
              {formatActionLabel(entry.action_type, t)}
            </p>
            {detailText && <p className="line-clamp-2 text-xs text-muted">{detailText}</p>}
          </>
        );
        return (
          <li key={rowKey} className="relative flex gap-3 pb-0">
            {/* timeline rail */}
            <div className="flex flex-col items-center">
              <span
                aria-hidden="true"
                className={`mt-4 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-surface ${timelineDotClass[dotColor]}`}
              />
              {!isLast && <span aria-hidden="true" className="w-px flex-1 bg-divider" />}
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-3 py-3">
              <ActivityChip actionType={entry.action_type} />
              {target ? (
                <Link
                  to={tenantPath(target)}
                  className="group/row min-w-0 flex-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span className="block [&>p:first-child]:group-hover/row:underline">{text}</span>
                </Link>
              ) : (
                <div className="min-w-0 flex-1">{text}</div>
              )}
              <TimeAgo createdAt={entry.created_at} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

interface BrokerActivityTimelineProps {
  entries: BrokerDashboardActivityEntry[];
  /** The feed itself failed to load (named in `_failed_metrics`). */
  failed?: boolean;
}

export function BrokerActivityTimeline({ entries, failed = false }: BrokerActivityTimelineProps) {
  const { t } = useTranslation('broker');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [all, setAll] = useState<BrokerDashboardActivityEntry[] | null>(null);
  const [drawerError, setDrawerError] = useState(false);

  const loadAll = useCallback(async () => {
    setDrawerError(false);
    setAll(null);
    try {
      const res = await adminBroker.getDashboard({ only: 'activity', activity_limit: ACTIVITY_DRAWER_LIMIT });
      const data = res.data as BrokerDashboardExtras | null | undefined;
      if (res.success && data && Array.isArray(data.recent_activity)) {
        setAll(data.recent_activity);
      } else {
        setDrawerError(true);
      }
    } catch {
      setDrawerError(true);
    }
  }, []);

  useEffect(() => {
    if (drawerOpen) void loadAll();
  }, [drawerOpen, loadAll]);

  return (
    <>
      <BrokerSectionCard
        title={t('dashboard.recent_activity')}
        icon={Activity}
        color="accent"
        count={failed ? null : entries.length}
        description={t('dashboard.broker_actions_heading')}
        onViewAll={entries.length > 0 ? () => setDrawerOpen(true) : undefined}
        viewAllLabel={t('dashboard.see_all')}
        flush
      >
        {failed ? (
          <BrokerEmptyState
            bare
            icon={AlertCircle}
            color="danger"
            title={t('dashboard.load_error_title')}
            hint={t('dashboard.load_error_hint')}
          />
        ) : entries.length > 0 ? (
          <ActivityList entries={entries} />
        ) : (
          <BrokerEmptyState
            bare
            icon={Activity}
            title={t('dashboard.no_recent_activity')}
            hint={t('dashboard.no_recent_activity_hint')}
          />
        )}
      </BrokerSectionCard>

      <Drawer isOpen={drawerOpen} onOpenChange={setDrawerOpen} placement="right" size="lg">
        <DrawerContent aria-label={t('dashboard.activity_drawer_title')}>
          <DrawerHeader className="shrink-0 border-b border-divider px-5 py-4 pr-14">
            <DrawerHeading className="text-base font-semibold leading-snug text-foreground">
              {t('dashboard.activity_drawer_title')}
            </DrawerHeading>
            <p className="mt-1 text-xs text-muted">{t('dashboard.activity_drawer_hint', { count: ACTIVITY_DRAWER_LIMIT })}</p>
          </DrawerHeader>
          <DrawerBody className="!m-0 px-1 py-2">
            {drawerError ? (
              <BrokerEmptyState
                bare
                icon={AlertCircle}
                color="danger"
                title={t('dashboard.load_error_title')}
                hint={t('dashboard.load_error_hint')}
                action={
                  <Button size="sm" variant="danger-soft" onPress={() => void loadAll()}>
                    {t('dashboard.refresh')}
                  </Button>
                }
              />
            ) : all === null ? (
              <BrokerSkeleton variant="timeline" count={8} className="border-0 shadow-none" />
            ) : all.length > 0 ? (
              <ActivityList entries={all} />
            ) : (
              <BrokerEmptyState
                bare
                icon={Activity}
                title={t('dashboard.no_recent_activity')}
                hint={t('dashboard.no_recent_activity_hint')}
              />
            )}
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </>
  );
}

export default BrokerActivityTimeline;
