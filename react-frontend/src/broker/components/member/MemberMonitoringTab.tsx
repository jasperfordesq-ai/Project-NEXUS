// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Member window — Monitoring tab: whether the member is under message
 * monitoring, since when and until when, with "Add to monitoring" when they
 * are not and "Extend" when they are. Both post the same upsert the
 * Monitoring page uses (`adminBroker.setMonitoring`): `under_monitoring`,
 * `reason`, `expires_days`. The monitoring list has no `user_id` filter, so
 * it is read whole and the member's row picked out.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Eye from 'lucide-react/icons/eye';
import UserPlus from 'lucide-react/icons/user-plus';
import CalendarPlus from 'lucide-react/icons/calendar-plus';
import { Button, Chip, Select, SelectItem, Textarea } from '@/components/ui';
import { useToast } from '@/contexts';
import { adminBroker } from '@/admin/api/adminApi';
import type { MonitoredUser } from '@/admin/api/types';
import { formatServerDate, parseServerTimestamp } from '@/lib/serverTime';
import { MemberTabSection, MemberTabRow } from './MemberTabSection';
import { asArray, useMemberTabData } from './memberWindowData';

const DURATIONS = ['7', '14', '30', '60', '90'] as const;

async function loadMonitoring(userId: number) {
  const res = await adminBroker.getMonitoring();
  if (!res.success) throw new Error('monitoring');
  return { rows: asArray<MonitoredUser>(res.data).filter((m) => Number(m.user_id) === userId), truncated: false };
}

interface MemberMonitoringTabProps {
  userId: number;
  /** Called after monitoring was added or extended, so the parent can refresh. */
  onChanged?: () => void;
}

export function MemberMonitoringTab({ userId, onChanged }: MemberMonitoringTabProps) {
  const { t } = useTranslation('broker');
  const toast = useToast();
  const data = useMemberTabData<MonitoredUser>(userId, loadMonitoring);
  const current = data.rows[0] ?? null;

  const [formOpen, setFormOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [days, setDays] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const openForm = useCallback(() => {
    setReason(current?.monitoring_reason ?? '');
    setDays('');
    setFormOpen(true);
  }, [current]);

  const submit = useCallback(async () => {
    if (!reason.trim()) {
      toast.error(t('monitoring.reason_required'));
      return;
    }
    setSaving(true);
    try {
      // Extending without a chosen duration keeps the remaining time (as the
      // Monitoring page does), so a reason-only edit never clears the expiry.
      let expiresDays = days ? Number(days) : undefined;
      if (!expiresDays && current?.monitoring_expires_at) {
        const expiresAt = parseServerTimestamp(current.monitoring_expires_at);
        if (expiresAt) expiresDays = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000));
      }
      const res = await adminBroker.setMonitoring(userId, {
        under_monitoring: true,
        reason: reason.trim(),
        ...(expiresDays ? { expires_days: expiresDays } : {}),
      });
      if (res.success) {
        toast.success(t(current ? 'member_detail.monitoring_extended' : 'member_detail.monitoring_added'));
        setFormOpen(false);
        data.reload();
        onChanged?.();
      } else {
        toast.error(res.error || t('member_detail.action_failed'));
      }
    } catch {
      toast.error(t('member_detail.action_failed'));
    } finally {
      setSaving(false);
    }
  }, [reason, days, current, userId, toast, t, data, onChanged]);

  const actionButton = !data.loading && !data.error && !formOpen && (
    <div className="flex justify-end">
      <Button
        size="sm"
        variant={current ? 'tertiary' : 'secondary'}
        startContent={current ? <CalendarPlus size={14} aria-hidden="true" /> : <UserPlus size={14} aria-hidden="true" />}
        onPress={openForm}
      >
        {current ? t('member_detail.monitoring_extend') : t('member_detail.monitoring_add')}
      </Button>
    </div>
  );

  const form = formOpen && (
    <div className="space-y-3 rounded-xl border border-divider/70 bg-surface p-3">
      <Textarea
        label={t('monitoring.reason_label')}
        placeholder={t('monitoring.reason_placeholder')}
        value={reason}
        onValueChange={setReason}
        minRows={2}
        variant="bordered"
        isRequired
      />
      <Select
        label={t('monitoring.duration_label')}
        placeholder={t('monitoring.duration_placeholder')}
        size="sm"
        variant="bordered"
        selectedKeys={days ? [days] : []}
        onSelectionChange={(keys) => setDays((Array.from(keys)[0] as string) ?? '')}
        className="max-w-[220px]"
      >
        {DURATIONS.map((d) => (
          <SelectItem key={d} id={d}>{t(`monitoring.duration_${d}_days`)}</SelectItem>
        ))}
      </Select>
      {current?.monitoring_expires_at && (
        <p className="text-xs text-muted">{t('monitoring.current_expiry', { date: formatServerDate(current.monitoring_expires_at) })}</p>
      )}
      <div className="flex gap-2">
        <Button size="sm" color="primary" isLoading={saving} onPress={() => void submit()}>
          {current ? t('member_detail.monitoring_extend') : t('member_detail.monitoring_add')}
        </Button>
        <Button size="sm" variant="flat" isDisabled={saving} onPress={() => setFormOpen(false)}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );

  return (
    <MemberTabSection
      loading={data.loading}
      error={data.error}
      onRetry={data.reload}
      isEmpty={!current}
      empty={{ icon: Eye, title: t('member_detail.monitoring_empty_title'), hint: t('member_detail.monitoring_empty_hint') }}
      seeAllPath="/broker/monitoring"
      header={
        <>
          {actionButton}
          {form}
        </>
      }
    >
      {current && (
        <MemberTabRow
          title={t('member_detail.monitoring_active_title')}
          detail={
            <>
              {current.monitoring_reason && <span>{current.monitoring_reason}</span>}
              {current.monitoring_started_at && (
                <span className="tabular-nums">{t('member_detail.monitoring_since', { date: formatServerDate(current.monitoring_started_at) })}</span>
              )}
              <span className="tabular-nums">
                {current.monitoring_expires_at
                  ? t('member_detail.monitoring_until', { date: formatServerDate(current.monitoring_expires_at) })
                  : t('member_detail.monitoring_no_end')}
              </span>
            </>
          }
          aside={
            current.messaging_disabled ? (
              <Chip size="sm" variant="soft" color="danger">{t('monitoring.status_messaging_off')}</Chip>
            ) : (
              <Chip size="sm" variant="soft" color="warning">{t('member_detail.monitoring_active_title')}</Chip>
            )
          }
        />
      )}
    </MemberTabSection>
  );
}

export default MemberMonitoringTab;
