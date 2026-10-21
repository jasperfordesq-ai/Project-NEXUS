// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * One wellbeing alert, opened by staff from the Wellbeing page, the broker
 * safeguarding page, or a bell/email link (?alert=): the volunteer, why the
 * alert was raised, the check-ins they chose to share (note included), who was
 * told and whether it worked, and the permanent staff notes.
 *
 * Brokers, coordinators and admins all use this; nothing here is admin-only.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import HeartPulse from 'lucide-react/icons/heart-pulse';
import Check from 'lucide-react/icons/check';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import X from 'lucide-react/icons/x';
import MessageSquare from 'lucide-react/icons/message-square';
import UserRound from 'lucide-react/icons/user-round';
import { Link } from 'react-router-dom';
import { Avatar, Button, Chip, Skeleton, Textarea } from '@/components/ui';
import { Drawer, DrawerContent, DrawerHeader, DrawerHeading, DrawerBody, DrawerFooter } from '@/components/ui/Drawer';
import { useTenant, useToast } from '@/contexts';
import { getFormattingLocale } from '@/lib/helpers';
import { adminVolunteering } from '../../api/adminApi';
import type { WellbeingStatus } from './WellbeingAlertsPanel';

export interface WellbeingAlertDetailAlert {
  id: number;
  user_id: number;
  user_name: string;
  avatar_url?: string | null;
  risk_level: string;
  risk_score: number;
  reason: 'low_mood' | 'activity' | string;
  status: string;
  coordinator_notified: boolean;
  legacy_notes: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WellbeingSharedCheckin {
  id: number;
  mood: number;
  note: string | null;
  created_at: string;
  team_notified_at: string | null;
}

export interface WellbeingNotificationRow {
  id: number;
  checkin_id: number;
  recipient: { id: number; name: string; other_community: boolean } | null;
  email_masked: string | null;
  organisation: string | null;
  tier: string;
  channel: 'bell' | 'email' | string;
  status: 'queued' | 'sent' | 'failed' | string;
  error_code: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface WellbeingNote {
  id: number;
  author: { id: number | null; name: string };
  body: string;
  created_at: string;
}

export interface WellbeingAlertDetail {
  alert: WellbeingAlertDetailAlert;
  indicators: Record<string, Record<string, unknown>>;
  checkins: WellbeingSharedCheckin[];
  notifications: WellbeingNotificationRow[];
  notes: WellbeingNote[];
}

export interface WellbeingAlertDrawerProps {
  alertId: number | null;
  isOpen: boolean;
  onClose: () => void;
  /** Called after a status change or a note, so the list behind can refresh. */
  onChanged: () => void;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(getFormattingLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

function moodLabel(mood: number | undefined, t: TFunction): string {
  switch (mood) {
    case 1: return t('volunteering.wellbeing_mood_struggling');
    case 2: return t('volunteering.wellbeing_mood_low');
    case 3: return t('volunteering.wellbeing_mood_okay');
    case 4: return t('volunteering.wellbeing_mood_good');
    case 5: return t('volunteering.wellbeing_mood_great');
    default: return '';
  }
}

const TIER_KEYS: Record<string, string> = {
  contact: 'volunteering.wellbeing_tier_contact',
  contact_email: 'volunteering.wellbeing_tier_contact_email',
  staff: 'volunteering.wellbeing_tier_staff',
  self: 'volunteering.wellbeing_tier_self',
  organisation: 'volunteering.wellbeing_tier_organisation',
  parent_staff: 'volunteering.wellbeing_tier_parent_staff',
  community_contact_email: 'volunteering.wellbeing_tier_community_contact_email',
};

/** Every trend value VolunteerWellbeingService::detectBurnoutRisk() writes. */
const TREND_KEYS: Record<string, string> = {
  stable: 'volunteering.wellbeing_trend_stable',
  increasing: 'volunteering.wellbeing_trend_increasing',
  slightly_declining: 'volunteering.wellbeing_trend_slightly_declining',
  declining: 'volunteering.wellbeing_trend_declining',
  declining_significantly: 'volunteering.wellbeing_trend_declining_significantly',
};

function trendLabel(trend: string, t: TFunction): string {
  return t(TREND_KEYS[trend] ?? 'volunteering.wellbeing_trend_unknown');
}

const STATUS_KEYS: Record<string, string> = {
  active: 'volunteering.wellbeing_status_active',
  acknowledged: 'volunteering.wellbeing_status_acknowledged',
  resolved: 'volunteering.wellbeing_status_resolved',
  dismissed: 'volunteering.wellbeing_status_dismissed',
};

const DELIVERY_COLORS: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
  sent: 'success',
  queued: 'warning',
  failed: 'danger',
};

/** The indicator rows worth showing, read defensively from the stored JSON. */
function indicatorRows(indicators: Record<string, Record<string, unknown>>, t: TFunction): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  const mood = indicators.mood;
  if (mood && typeof mood.latest_mood === 'number') {
    rows.push({ label: t('volunteering.wellbeing_indicator_mood'), value: moodLabel(mood.latest_mood, t) });
  }
  if (mood && typeof mood.low_checkins_14_days === 'number') {
    rows.push({ label: t('volunteering.wellbeing_indicator_low_checkins'), value: String(mood.low_checkins_14_days) });
  }
  const gap = indicators.engagement_gap;
  if (gap && typeof gap.days_since_last_activity === 'number') {
    rows.push({ label: t('volunteering.wellbeing_indicator_engagement_gap'), value: String(gap.days_since_last_activity) });
  }
  const hours = indicators.hours_trend;
  if (hours && typeof hours.trend === 'string') {
    rows.push({ label: t('volunteering.wellbeing_indicator_hours_trend'), value: trendLabel(hours.trend, t) });
  }
  const shifts = indicators.shift_frequency;
  if (shifts && typeof shifts.trend === 'string') {
    rows.push({ label: t('volunteering.wellbeing_indicator_shift_frequency'), value: trendLabel(shifts.trend, t) });
  }
  // The cancellation rate was never measured (21 Oct 2026): the server now sends
  // measured:false with a null rate. Older rows carried rate_percent 0, which
  // read as a confident "0%"; only a real number is shown as a percentage.
  const cancel = indicators.cancellation_rate;
  if (cancel) {
    const measured = cancel.measured !== false && typeof cancel.rate_percent === 'number';
    rows.push({
      label: t('volunteering.wellbeing_indicator_cancellation_rate'),
      value: measured ? `${cancel.rate_percent as number}%` : t('volunteering.wellbeing_indicator_not_measured'),
    });
  }
  // The stored key is upcoming_shifts_7_days; upcoming_shifts is kept only as a fallback.
  const over = indicators.overcommitment;
  const upcoming = over
    ? (typeof over.upcoming_shifts_7_days === 'number' ? over.upcoming_shifts_7_days
      : typeof over.upcoming_shifts === 'number' ? over.upcoming_shifts : null)
    : null;
  if (upcoming !== null) {
    rows.push({ label: t('volunteering.wellbeing_indicator_overcommitment'), value: String(upcoming) });
  }
  return rows;
}

export function WellbeingAlertDrawer({ alertId, isOpen, onClose, onChanged }: WellbeingAlertDrawerProps) {
  const { t } = useTranslation('admin_volunteering');
  const toast = useToast();
  const { tenantPath } = useTenant();
  const [detail, setDetail] = useState<WellbeingAlertDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [acting, setActing] = useState<WellbeingStatus | null>(null);
  // Each load gets a sequence number; a response for anything but the latest
  // load is dropped (21 Oct 2026). Without this, closing alert A while its
  // request was pending and opening B let A's reply overwrite B's detail.
  const requestSeq = useRef(0);

  const load = useCallback(async (id: number) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await adminVolunteering.getWellbeingAlert(id);
      if (seq !== requestSeq.current) return;
      if (res.success && res.data && typeof res.data === 'object' && 'alert' in (res.data as object)) {
        setDetail(res.data as WellbeingAlertDetail);
      } else {
        setDetail(null);
        setError(t('volunteering.wellbeing_detail_failed'));
      }
    } catch {
      if (seq !== requestSeq.current) return;
      setDetail(null);
      setError(t('volunteering.wellbeing_detail_failed'));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => {
    // Whatever was shown belongs to another alert (or to nothing): clear it at once.
    setDetail(null);
    setError(null);
    setNote('');
    if (isOpen && alertId != null) {
      void load(alertId);
    } else {
      // Invalidate any in-flight load so it cannot land after closing.
      requestSeq.current += 1;
      setLoading(false);
    }
  }, [isOpen, alertId, load]);

  // Only a detail that belongs to the alert this drawer is open for may be
  // shown or acted on; a stale one is treated as absent.
  const current = detail && alertId != null && detail.alert.id === alertId ? detail : null;

  const saveNote = useCallback(async () => {
    if (alertId == null || detail?.alert.id !== alertId) return;
    const body = note.trim();
    if (!body) return;
    setSavingNote(true);
    try {
      const res = await adminVolunteering.addWellbeingAlertNote(alertId, body);
      const saved = res.success && res.data && typeof res.data === 'object' ? (res.data as { note?: WellbeingNote }).note : undefined;
      if (saved) {
        setDetail((prev) => (prev ? { ...prev, notes: [...prev.notes, saved] } : prev));
        setNote('');
        toast.success(t('volunteering.wellbeing_note_saved'));
        onChanged();
      } else {
        toast.error(t('volunteering.wellbeing_note_failed'));
      }
    } catch {
      toast.error(t('volunteering.wellbeing_note_failed'));
    }
    setSavingNote(false);
  }, [alertId, detail, note, toast, t, onChanged]);

  const act = useCallback(async (next: Exclude<WellbeingStatus, 'active'>) => {
    if (alertId == null || detail?.alert.id !== alertId) return;
    setActing(next);
    try {
      const res = await adminVolunteering.updateWellbeingAlert(alertId, next);
      if (res.success) {
        toast.success(t('volunteering.wellbeing_alert_updated'));
        setDetail((prev) => (prev ? { ...prev, alert: { ...prev.alert, status: next } } : prev));
        onChanged();
      } else {
        toast.error(t('volunteering.wellbeing_alert_update_failed'));
      }
    } catch {
      toast.error(t('volunteering.wellbeing_alert_update_failed'));
    }
    setActing(null);
  }, [alertId, detail, toast, t, onChanged]);

  const alert = current?.alert;
  const name = alert?.user_name ?? '';
  const told = current?.notifications ?? [];
  const canAct = current !== null;

  return (
    <Drawer isOpen={isOpen} onClose={onClose} placement="right" size="lg">
      <DrawerContent aria-label={t('volunteering.wellbeing_drawer_aria', { name })}>
        <DrawerHeader className="shrink-0 border-b border-divider px-5 py-4 pr-14">
          <div className="flex items-center gap-3">
            <HeartPulse size={18} className="text-danger shrink-0" aria-hidden="true" />
            <DrawerHeading className="text-base font-bold leading-snug text-foreground">
              {alert ? name : t('volunteering.wellbeing_alerts_title')}
            </DrawerHeading>
          </div>
        </DrawerHeader>

        <DrawerBody className="!m-0 space-y-6 px-5 py-4">
          {loading && !current ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
            </div>
          ) : error ? (
            <p className="text-sm text-danger">{error}</p>
          ) : alert && current ? (
            <>
              {/* The volunteer */}
              <section className="flex items-start gap-3">
                <Avatar src={alert.avatar_url ?? undefined} name={name} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip size="sm" variant="soft" color={alert.reason === 'low_mood' ? 'danger' : 'default'}>
                      {alert.reason === 'low_mood' ? t('volunteering.wellbeing_reason_low') : t('volunteering.wellbeing_reason_activity')}
                    </Chip>
                    <Chip size="sm" variant="soft" color={alert.risk_level === 'high' || alert.risk_level === 'critical' ? 'danger' : alert.risk_level === 'moderate' ? 'warning' : 'success'}>
                      {t('volunteering.wellbeing_risk_score', { score: Math.round(alert.risk_score) })}
                    </Chip>
                    <Chip size="sm" variant="soft">{t(STATUS_KEYS[alert.status] ?? 'volunteering.wellbeing_status_active')}</Chip>
                  </div>
                  <p className="text-xs text-muted mt-1">
                    {t('volunteering.wellbeing_raised_on', { date: formatDateTime(alert.created_at) })}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link
                      to={tenantPath(`/profile/${alert.user_id}`)}
                      className="inline-flex items-center gap-1 text-sm font-medium text-accent underline-offset-2 hover:underline"
                    >
                      <UserRound size={14} aria-hidden="true" />
                      {t('volunteering.wellbeing_view_profile')}
                    </Link>
                    <Link
                      to={tenantPath(`/messages/${alert.user_id}`)}
                      className="inline-flex items-center gap-1 text-sm font-medium text-accent underline-offset-2 hover:underline"
                    >
                      <MessageSquare size={14} aria-hidden="true" />
                      {t('volunteering.wellbeing_message_volunteer', { name })}
                    </Link>
                  </div>
                </div>
              </section>

              {/* Why */}
              <section>
                <h4 className="text-sm font-semibold mb-2">{t('volunteering.wellbeing_section_why')}</h4>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {indicatorRows(current.indicators ?? {}, t).map((row) => (
                    <div key={row.label} className="contents">
                      <dt className="text-muted">{row.label}</dt>
                      <dd className="font-medium">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              {/* What they shared */}
              <section>
                <h4 className="text-sm font-semibold mb-2">{t('volunteering.wellbeing_section_checkins')}</h4>
                {current.checkins.length === 0 ? (
                  <p className="text-sm text-muted">{t('volunteering.wellbeing_no_shared_checkins')}</p>
                ) : (
                  <ul className="space-y-2">
                    {current.checkins.map((c) => (
                      <li key={c.id} className="rounded-lg border border-divider/70 bg-surface-secondary/30 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-medium">{moodLabel(c.mood, t)}</span>
                          <span className="text-xs text-muted">{formatDateTime(c.created_at)}</span>
                          {c.team_notified_at && (
                            <Chip size="sm" variant="soft" color="success">{t('volunteering.wellbeing_checkin_told_team')}</Chip>
                          )}
                        </div>
                        {c.note && c.note.trim() !== '' && (
                          // Plain text only — React escapes it; never rendered as HTML.
                          <p className="mt-1 text-sm whitespace-pre-wrap break-words">{c.note}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Who was told */}
              <section>
                <h4 className="text-sm font-semibold mb-2">{t('volunteering.wellbeing_section_told')}</h4>
                {told.length === 0 ? (
                  <p className="text-sm text-warning-foreground rounded-lg bg-warning/10 px-3 py-2">{t('volunteering.wellbeing_told_none')}</p>
                ) : (
                  <ul className="divide-y divide-divider/70 rounded-lg border border-divider/70">
                    {told.map((n) => (
                      <li key={n.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                        <span className="font-medium">
                          {n.recipient ? n.recipient.name : n.email_masked ?? '—'}
                        </span>
                        {n.recipient?.other_community && (
                          <span className="text-xs text-muted">({t('volunteering.wellbeing_other_community')})</span>
                        )}
                        <span className="text-xs text-muted">{t(TIER_KEYS[n.tier] ?? 'volunteering.wellbeing_tier_staff')}</span>
                        <Chip size="sm" variant="soft">{n.channel === 'bell' ? t('volunteering.wellbeing_channel_bell') : t('volunteering.wellbeing_channel_email')}</Chip>
                        <Chip size="sm" variant="soft" color={DELIVERY_COLORS[n.status] ?? 'default'}>
                          {n.status === 'sent' ? t('volunteering.wellbeing_delivery_sent')
                            : n.status === 'failed' ? t('volunteering.wellbeing_delivery_failed')
                            : t('volunteering.wellbeing_delivery_queued')}
                        </Chip>
                        <span className="ml-auto text-xs text-muted">{formatDateTime(n.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Notes */}
              <section>
                <h4 className="text-sm font-semibold mb-1">{t('volunteering.wellbeing_section_notes')}</h4>
                <p className="text-xs text-muted mb-2">{t('volunteering.wellbeing_notes_permanent')}</p>
                {alert.legacy_notes && (
                  <div className="mb-2 rounded-lg bg-surface-secondary/60 px-3 py-2">
                    <p className="text-xs font-medium text-muted">{t('volunteering.wellbeing_legacy_notes')}</p>
                    <p className="text-sm whitespace-pre-wrap break-words">{alert.legacy_notes}</p>
                  </div>
                )}
                {current.notes.length === 0 ? (
                  <p className="text-sm text-muted">{t('volunteering.wellbeing_notes_empty')}</p>
                ) : (
                  <ul className="space-y-2">
                    {current.notes.map((n) => (
                      <li key={n.id} className="rounded-lg border border-divider/70 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                          <span className="font-medium text-foreground">{n.author.name}</span>
                          <span>{formatDateTime(n.created_at)}</span>
                        </div>
                        <p className="mt-1 text-sm whitespace-pre-wrap break-words">{n.body}</p>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 space-y-2">
                  <Textarea
                    label={t('volunteering.wellbeing_add_note_label')}
                    placeholder={t('volunteering.wellbeing_add_note_placeholder')}
                    value={note}
                    onValueChange={setNote}
                    maxLength={5000}
                    minRows={2}
                  />
                  <Button size="sm" variant="primary" isLoading={savingNote} isDisabled={!canAct || note.trim() === ''} onPress={() => void saveNote()}>
                    {t('volunteering.wellbeing_save_note')}
                  </Button>
                </div>
              </section>
            </>
          ) : null}
        </DrawerBody>

        {alert && (
          <DrawerFooter className="shrink-0 border-t border-divider px-5 py-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="tertiary" startContent={<Check size={14} aria-hidden="true" />} isLoading={acting === 'acknowledged'} isDisabled={!canAct || acting !== null} onPress={() => void act('acknowledged')}>
                {t('volunteering.wellbeing_acknowledge')}
              </Button>
              <Button size="sm" variant="tertiary" color="success" startContent={<CheckCircle size={14} aria-hidden="true" />} isLoading={acting === 'resolved'} isDisabled={!canAct || acting !== null} onPress={() => void act('resolved')}>
                {t('volunteering.wellbeing_resolve')}
              </Button>
              <Button size="sm" variant="tertiary" startContent={<X size={14} aria-hidden="true" />} isLoading={acting === 'dismissed'} isDisabled={!canAct || acting !== null} onPress={() => void act('dismissed')}>
                {t('volunteering.wellbeing_dismiss')}
              </Button>
            </div>
          </DrawerFooter>
        )}
      </DrawerContent>
    </Drawer>
  );
}

export default WellbeingAlertDrawer;
