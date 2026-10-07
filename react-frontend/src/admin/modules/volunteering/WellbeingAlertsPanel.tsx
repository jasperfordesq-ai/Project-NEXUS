// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Volunteer wellbeing alerts — the list a community's team works from when a
 * volunteer says they are Low or Struggling (and lets someone get in touch), or
 * when their activity pattern suggests burnout.
 *
 * Used on the admin Volunteering overview and on the broker Safeguarding ›
 * Volunteering page. The endpoints are open to brokers and coordinators as well
 * as admins.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import HeartPulse from 'lucide-react/icons/heart-pulse';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Check from 'lucide-react/icons/check';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import X from 'lucide-react/icons/x';
import { Card, CardBody, CardHeader, Button, Chip, Skeleton, Select, SelectItem } from '@/components/ui';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';

export type WellbeingStatus = 'active' | 'acknowledged' | 'resolved' | 'dismissed';

type RiskLevel = 'low' | 'moderate' | 'high' | 'critical';

interface WellbeingLatestCheckin {
  mood?: number;
  note?: string | null;
  created_at?: string;
}

/**
 * Admin wellbeing alert. Every field is optional — the UI reads defensively and
 * falls back to whatever identifying fields the item exposes.
 */
export interface WellbeingAlert {
  id?: number | string;
  user_id?: number;
  user_name?: string;
  name?: string;
  display_name?: string;
  volunteer_name?: string;
  risk_level?: string;
  severity?: string;
  status?: string;
  /** Why the alert was raised: the volunteer said they feel low, or an activity pattern. */
  reason?: 'low_mood' | 'activity' | string;
  latest_checkin?: WellbeingLatestCheckin | null;
  created_at?: string;
  updated_at?: string;
}

/** Pull the alert list out of any of the envelope shapes the endpoint may use. */
export function extractWellbeingAlerts(payload: unknown): WellbeingAlert[] {
  if (Array.isArray(payload)) return payload as WellbeingAlert[];
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    if (Array.isArray(p.data)) return p.data as WellbeingAlert[];
    if (Array.isArray(p.items)) return p.items as WellbeingAlert[];
    if (p.data && typeof p.data === 'object') {
      const inner = p.data as Record<string, unknown>;
      if (Array.isArray(inner.items)) return inner.items as WellbeingAlert[];
      if (Array.isArray(inner.data)) return inner.data as WellbeingAlert[];
    }
  }
  return [];
}

function alertName(a: WellbeingAlert, t: TFunction): string {
  return (
    a.user_name ||
    a.name ||
    a.display_name ||
    a.volunteer_name ||
    (a.user_id != null ? t('volunteering.wellbeing_user_number', { id: a.user_id }) : t('volunteering.wellbeing_unknown_user'))
  );
}

function latestCheckin(a: WellbeingAlert): WellbeingLatestCheckin | null {
  const c = a.latest_checkin;
  return c && typeof c === 'object' ? c : null;
}

function reasonLabel(a: WellbeingAlert, t: TFunction): string {
  if (a.reason === 'low_mood') {
    return latestCheckin(a)?.mood === 1
      ? t('volunteering.wellbeing_reason_struggling')
      : t('volunteering.wellbeing_reason_low');
  }
  return t('volunteering.wellbeing_reason_activity');
}

function moodLabel(mood: number | undefined, t: TFunction): string | null {
  switch (mood) {
    case 1: return t('volunteering.wellbeing_mood_struggling');
    case 2: return t('volunteering.wellbeing_mood_low');
    case 3: return t('volunteering.wellbeing_mood_okay');
    case 4: return t('volunteering.wellbeing_mood_good');
    case 5: return t('volunteering.wellbeing_mood_great');
    default: return null;
  }
}

const RISK_COLORS: Record<RiskLevel, 'success' | 'warning' | 'danger'> = {
  low: 'success',
  moderate: 'warning',
  high: 'danger',
  critical: 'danger',
};

function isRiskLevel(value: unknown): value is RiskLevel {
  return typeof value === 'string' && value in RISK_COLORS;
}

function riskLabel(level: RiskLevel, t: TFunction): string {
  switch (level) {
    case 'low': return t('volunteering.wellbeing_risk_low');
    case 'moderate': return t('volunteering.wellbeing_risk_moderate');
    case 'high': return t('volunteering.wellbeing_risk_high');
    case 'critical': return t('volunteering.wellbeing_risk_critical');
  }
}

function formatDateTime(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(getFormattingLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

export interface WellbeingAlertsPanelProps {
  /** Change this value to make the panel reload (e.g. from a page-level Refresh button). */
  refreshKey?: number;
}

export function WellbeingAlertsPanel({ refreshKey = 0 }: WellbeingAlertsPanelProps) {
  const { t } = useTranslation('admin_volunteering');
  const toast = useToast();
  const [alerts, setAlerts] = useState<WellbeingAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<WellbeingStatus>('active');
  const [actionId, setActionId] = useState<number | string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAlerts = useCallback(async (filter: WellbeingStatus) => {
    setLoading(true);
    try {
      const res = await api.get(`/v2/admin/volunteering/wellbeing/alerts?status=${filter}`);
      if (res.success) {
        setAlerts(extractWellbeingAlerts(res.data));
        setError(null);
      } else {
        setAlerts([]);
        setError(t('volunteering.failed_to_load_wellbeing_alerts'));
      }
    } catch {
      setAlerts([]);
      setError(t('volunteering.failed_to_load_wellbeing_alerts'));
    }
    setLoading(false);
  }, [t]);

  const handleAction = useCallback(async (alert: WellbeingAlert, next: WellbeingStatus) => {
    if (alert.id == null) return;
    setActionId(alert.id);
    try {
      const res = await api.put(`/v2/admin/volunteering/wellbeing/alerts/${alert.id}`, { status: next });
      if (res.success) {
        toast.success(t('volunteering.wellbeing_alert_updated'));
        loadAlerts(status);
      } else {
        toast.error(t('volunteering.wellbeing_alert_update_failed'));
      }
    } catch {
      toast.error(t('volunteering.wellbeing_alert_update_failed'));
    }
    setActionId(null);
  }, [toast, t, loadAlerts, status]);

  useEffect(() => { loadAlerts(status); }, [loadAlerts, status, refreshKey]);

  return (
    <Card className="border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <HeartPulse size={18} className="text-danger" aria-hidden="true" />
          <h3 className="text-lg font-semibold">{t('volunteering.wellbeing_alerts_title')}</h3>
        </div>
        <Select
          aria-label={t('volunteering.wellbeing_filter_status_aria')}
          className="w-44"
          size="sm"
          selectedKeys={new Set([status])}
          onSelectionChange={(keys) => {
            const val = Array.from(keys)[0] as WellbeingStatus;
            if (val) setStatus(val);
          }}
        >
          <SelectItem key="active" id="active">{t('volunteering.wellbeing_status_active')}</SelectItem>
          <SelectItem key="acknowledged" id="acknowledged">{t('volunteering.wellbeing_status_acknowledged')}</SelectItem>
          <SelectItem key="resolved" id="resolved">{t('volunteering.wellbeing_status_resolved')}</SelectItem>
          <SelectItem key="dismissed" id="dismissed">{t('volunteering.wellbeing_status_dismissed')}</SelectItem>
        </Select>
      </CardHeader>
      <CardBody>
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center py-8 text-muted">
            <AlertTriangle size={32} className="mb-2 text-danger" aria-hidden="true" />
            <p>{error}</p>
            <Button size="sm" variant="tertiary" className="mt-3" onPress={() => loadAlerts(status)}>
              {t('volunteering.retry')}
            </Button>
          </div>
        ) : alerts.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-muted">
            <HeartPulse size={40} className="mb-2" aria-hidden="true" />
            <p>{t('volunteering.wellbeing_no_alerts')}</p>
            <p className="text-xs mt-1">{t('volunteering.wellbeing_no_alerts_desc')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert, idx) => {
              const busy = actionId !== null && actionId === alert.id;
              const otherBusy = actionId !== null && actionId !== alert.id;
              const level = alert.risk_level || alert.severity;
              const checkin = latestCheckin(alert);
              const checkinMood = moodLabel(checkin?.mood, t);
              const checkinWhen = formatDateTime(checkin?.created_at);
              const raisedOn = alert.created_at ? new Date(alert.created_at) : null;
              const note = typeof checkin?.note === 'string' ? checkin.note.trim() : '';
              return (
                <div
                  key={`${alert.id ?? 'alert'}-${idx}`}
                  className="flex flex-col gap-2 rounded-xl border border-divider/70 bg-surface-secondary/30 p-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{alertName(alert, t)}</span>
                      <Chip size="sm" variant="soft" color={alert.reason === 'low_mood' ? 'danger' : 'default'}>
                        {reasonLabel(alert, t)}
                      </Chip>
                      {isRiskLevel(level) && (
                        <Chip size="sm" variant="soft" color={RISK_COLORS[level]}>
                          {riskLabel(level, t)}
                        </Chip>
                      )}
                    </div>
                    {raisedOn && !Number.isNaN(raisedOn.getTime()) && (
                      <p className="text-xs text-muted mt-1">
                        {t('volunteering.wellbeing_raised_on', { date: raisedOn.toLocaleDateString(getFormattingLocale()) })}
                      </p>
                    )}
                    {checkinMood && (
                      <p className="text-sm mt-2">
                        {checkinWhen
                          ? t('volunteering.wellbeing_latest_checkin', { mood: checkinMood, date: checkinWhen })
                          : t('volunteering.wellbeing_latest_checkin_mood', { mood: checkinMood })}
                      </p>
                    )}
                    {note && (
                      <div className="mt-1 rounded-lg bg-surface-secondary/60 px-3 py-2">
                        <p className="text-xs font-medium text-muted">{t('volunteering.wellbeing_note_label')}</p>
                        {/* Plain text only — React escapes it; never rendered as HTML. */}
                        <p className="text-sm whitespace-pre-wrap break-words">{note}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="tertiary"
                      startContent={<Check size={14} aria-hidden="true" />}
                      isLoading={busy}
                      isDisabled={otherBusy}
                      onPress={() => handleAction(alert, 'acknowledged')}
                    >
                      {t('volunteering.wellbeing_acknowledge')}
                    </Button>
                    <Button
                      size="sm"
                      variant="tertiary"
                      color="success"
                      startContent={<CheckCircle size={14} aria-hidden="true" />}
                      isLoading={busy}
                      isDisabled={otherBusy}
                      onPress={() => handleAction(alert, 'resolved')}
                    >
                      {t('volunteering.wellbeing_resolve')}
                    </Button>
                    <Button
                      size="sm"
                      variant="tertiary"
                      startContent={<X size={14} aria-hidden="true" />}
                      isLoading={busy}
                      isDisabled={otherBusy}
                      onPress={() => handleAction(alert, 'dismissed')}
                    >
                      {t('volunteering.wellbeing_dismiss')}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export default WellbeingAlertsPanel;
