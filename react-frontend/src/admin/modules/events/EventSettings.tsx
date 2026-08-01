// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import CalendarCog from 'lucide-react/icons/calendar-cog';
import Gift from 'lucide-react/icons/gift';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import Save from 'lucide-react/icons/save';
import ShieldCheck from 'lucide-react/icons/shield-check';
import { PageHeader } from '../../components/PageHeader';
import { adminConfig, type EventConfiguration, type EventConfigurationAuditEntry, type EventConfigurationResponse } from '../../api/adminApi';
import { useTenant, useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import {
  Alert,
  Button,
  Card,
  Chip,
  Input,
  Select,
  SelectItem,
  Spinner,
  Switch,
  Textarea,
} from '@/components/ui';

type BooleanKey = {
  [K in keyof EventConfiguration]: EventConfiguration[K] extends boolean ? K : never
}[keyof EventConfiguration];

const POLICY_SECTIONS: Array<{ title: string; description: string; keys: BooleanKey[] }> = [
  { title: 'registration', description: 'registration_desc', keys: ['registration_enabled', 'guest_registration_enabled', 'waitlist_enabled', 'timed_waitlist_offers_enabled'] },
  { title: 'delivery', description: 'delivery_desc', keys: ['recurrence_enabled', 'reminders_enabled', 'organizer_broadcasts_enabled', 'offline_checkin_enabled', 'calendar_feeds_enabled', 'federation_sharing_enabled'] },
];

export default function EventSettings() {
  const { t } = useTranslation('admin_event_settings');
  usePageTitle(t('title'));
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { tenantPath, hasFeature } = useTenant();
  const [snapshot, setSnapshot] = useState<EventConfigurationResponse | null>(null);
  const [draft, setDraft] = useState<EventConfiguration | null>(null);
  // The cap renders from its own STRING state: a controlled number input
  // deriving its value from the parsed draft eats intermediate keystrokes —
  // typing the leading "0" of "0.5" parsed to 0 → null → the field wiped
  // itself, making every legal value below 1 untypeable.
  const [capText, setCapText] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [auditEntries, setAuditEntries] = useState<EventConfigurationAuditEntry[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [response, auditResponse] = await Promise.all([
        adminConfig.getEventConfig(),
        adminConfig.getEventConfigAuditLog(),
      ]);
      if (!response.success || !response.data) throw new Error(t('load_failed'));
      setSnapshot(response.data);
      setDraft(response.data.config);
      setCapText(response.data.config.attendance_credit_monthly_cap !== null ? String(response.data.config.attendance_credit_monthly_cap) : '');
      setReason('');
      setAuditEntries(auditResponse.success && auditResponse.data ? auditResponse.data : []);
    } catch {
      setLoadError(true);
      toast.error(t('load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => { void load(); }, [load]);

  const changed = useMemo(() => {
    if (!snapshot || !draft) return false;
    return JSON.stringify(snapshot.config) !== JSON.stringify(draft);
  }, [snapshot, draft]);

  const hasDisruptiveChange = useMemo(() => {
    if (!snapshot || !draft) return false;
    const affected: Array<[BooleanKey, number]> = [
      ['registration_enabled', snapshot.impact.active_registrations],
      ['waitlist_enabled', snapshot.impact.active_waitlist_entries],
      ['reminders_enabled', snapshot.impact.pending_reminders],
      ['calendar_feeds_enabled', snapshot.impact.active_calendar_tokens],
      ['federation_sharing_enabled', snapshot.impact.shared_events],
      ['organizer_broadcasts_enabled', snapshot.impact.scheduled_broadcasts],
    ];
    return affected.some(([key, count]) => snapshot.config[key] && !draft[key] && count > 0);
  }, [snapshot, draft]);

  const updateBoolean = (key: BooleanKey, value: boolean) => {
    setDraft(current => current ? { ...current, [key]: value } : current);
  };

  const save = async () => {
    if (!snapshot || !draft || !changed || !reason.trim()) return;
    if (hasDisruptiveChange) {
      const approved = await confirm({
        title: t('impact_confirm_title'),
        body: t('impact_confirm_body'),
        confirmLabel: t('save'),
        status: 'warning',
      });
      if (!approved) return;
    }
    setSaving(true);
    try {
      const response = await adminConfig.updateEventConfig(snapshot.version, draft, reason.trim(), hasDisruptiveChange);
      if (!response.success || !response.data) throw new Error(t('save_failed'));
      setSnapshot(response.data);
      setDraft(response.data.config);
      setCapText(response.data.config.attendance_credit_monthly_cap !== null ? String(response.data.config.attendance_credit_monthly_cap) : '');
      setReason('');
      const auditResponse = await adminConfig.getEventConfigAuditLog();
      setAuditEntries(auditResponse.success && auditResponse.data ? auditResponse.data : auditEntries);
      toast.success(t('saved'));
    } catch {
      toast.error(t('save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const restore = async (keys?: Array<keyof EventConfiguration>) => {
    if (!snapshot || !reason.trim()) return;
    const approved = await confirm({
      title: t(keys ? 'restore_section_confirm_title' : 'restore_confirm_title'),
      body: t(keys ? 'restore_section_confirm_body' : 'restore_confirm_body'),
      confirmLabel: t(keys ? 'restore_section' : 'restore_defaults'),
      status: 'warning',
    });
    if (!approved) return;
    setSaving(true);
    try {
      const response = await adminConfig.restoreEventConfigDefaults(snapshot.version, reason.trim(), keys);
      if (!response.success || !response.data) throw new Error(t('restore_failed'));
      setSnapshot(response.data);
      setDraft(response.data.config);
      setCapText(response.data.config.attendance_credit_monthly_cap !== null ? String(response.data.config.attendance_credit_monthly_cap) : '');
      setReason('');
      const auditResponse = await adminConfig.getEventConfigAuditLog();
      setAuditEntries(auditResponse.success && auditResponse.data ? auditResponse.data : auditEntries);
      toast.success(t('restored'));
    } catch {
      toast.error(t('restore_failed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-[420px] items-center justify-center" role="status" aria-label={t('loading')}><Spinner size="lg" /></div>;
  }
  if (loadError || !snapshot || !draft) {
    return <div className="mx-auto max-w-5xl px-4"><Alert color="danger" title={t('load_failed')}><Button size="sm" variant="secondary" onPress={load}>{t('retry')}</Button></Alert></div>;
  }

  const capabilities = snapshot.capabilities;
  return (
    <div className="mx-auto max-w-6xl px-4 pb-10">
      <PageHeader
        title={t('title')}
        description={t('description')}
        icon={<CalendarCog size={22} />}
        actions={<Chip variant="soft">{t('version', { version: snapshot.version })}</Chip>}
      />

      <Card className="mb-6">
        <Card.Header>
          <div><h2 className="text-base font-semibold">{t('readiness_title')}</h2><p className="text-sm text-muted">{t('readiness_desc')}</p></div>
        </Card.Header>
        <Card.Content className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {([
            ['recurrence_v2', capabilities.recurrence_v2],
            ['rolling_recurrence', capabilities.rolling_recurrence],
            ['timed_waitlist_offers', capabilities.timed_waitlist_offers],
            ['notification_consumer', capabilities.notification_consumer],
            ['attendance_credits', capabilities.attendance_credits],
            ['optional_analytics_capture', capabilities.optional_analytics_capture],
            ['registration_forms', capabilities.registration_forms],
            ['invitation_campaigns', capabilities.invitation_campaigns],
            ['ticketing', capabilities.ticketing],
            ['agenda', capabilities.agenda],
            ['offline_sync', capabilities.offline_sync],
            ['broadcast_delivery', capabilities.broadcast_delivery],
            ['safety_evidence', capabilities.safety_evidence],
            ['federation_delivery', capabilities.federation_delivery],
          ] as Array<[string, boolean]>).map(([key, available]) => (
            <div key={key} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-secondary p-3">
              <span className="text-sm font-medium">{t(`capability_${key}`)}</span>
              <Chip size="sm" variant="soft" color={available ? 'success' : 'default'}>{t(available ? 'available' : 'platform_off')}</Chip>
            </div>
          ))}
        </Card.Content>
      </Card>

      <Card className="mb-6">
        <Card.Header><div><h2 className="text-base font-semibold">{t('ownership_title')}</h2><p className="text-sm text-muted">{t('ownership_desc')}</p></div></Card.Header>
        <Card.Content className="grid gap-4 md:grid-cols-3">
          {(['tenant', 'event', 'member'] as const).map(scope => (
            <div key={scope} className="rounded-xl border border-border p-4">
              <p className="text-sm font-semibold">{t(`ownership_${scope}_title`)}</p>
              <p className="mt-1 text-xs leading-5 text-muted">{t(`ownership_${scope}_desc`)}</p>
            </div>
          ))}
        </Card.Content>
      </Card>

      <Card className="mb-6">
        <Card.Header><div><h2 className="text-base font-semibold">{t('impact_title')}</h2><p className="text-sm text-muted">{t('impact_desc')}</p></div></Card.Header>
        <Card.Content className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(snapshot.impact).map(([key, count]) => (
            <div key={key} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-secondary p-3">
              <span className="text-sm font-medium">{t(`impact_${key}`)}</span>
              <Chip size="sm" variant="soft" color={count > 0 ? 'warning' : 'default'}>{count}</Chip>
            </div>
          ))}
        </Card.Content>
      </Card>

      <div className="space-y-6">
        <Card>
          <Card.Header><div><h2 className="text-base font-semibold">{t('general')}</h2><p className="text-sm text-muted">{t('general_desc')}</p></div></Card.Header>
          <Card.Content className="grid gap-5 md:grid-cols-2">
            <Select label={t('creation_role')} aria-label={t('creation_role')} selectedKeys={[draft.creation_role]} onSelectionChange={(keys) => { const value = Array.from(keys)[0]; if (value) setDraft({ ...draft, creation_role: value as EventConfiguration['creation_role'] }); }}>
              <SelectItem id="members">{t('creation_role_members')}</SelectItem>
              <SelectItem id="staff">{t('creation_role_staff')}</SelectItem>
              <SelectItem id="admins">{t('creation_role_admins')}</SelectItem>
            </Select>
            <Input label={t('default_capacity')} type="number" min={0} max={100000} value={String(draft.default_capacity)} onValueChange={(value) => setDraft({ ...draft, default_capacity: Math.max(0, Math.min(100000, Number(value) || 0)) })} aria-label={t('default_capacity')} />
            <div className="flex items-start justify-between gap-6 border-t border-border pt-4 md:col-span-2">
              <div><p className="text-sm font-medium">{t('moderation_required')}</p><p className="mt-1 text-xs leading-5 text-muted">{t('moderation_required_desc')}</p></div>
              <Switch isSelected={draft.moderation_required} onValueChange={value => updateBoolean('moderation_required', value)} aria-label={t('moderation_required')} />
            </div>
          </Card.Content>
          <Card.Footer className="justify-end"><Button size="sm" variant="tertiary" startContent={<RotateCcw size={14} />} isDisabled={saving || !reason.trim()} onPress={() => void restore(['creation_role', 'moderation_required', 'default_capacity'])}>{t('restore_section')}</Button></Card.Footer>
        </Card>

        {POLICY_SECTIONS.map(section => (
          <Card key={section.title}>
            <Card.Header><div><h2 className="text-base font-semibold">{t(section.title)}</h2><p className="text-sm text-muted">{t(section.description)}</p></div></Card.Header>
            <Card.Content className="divide-y divide-border">
              {section.keys.map(key => {
                const blocked = key === 'timed_waitlist_offers_enabled' && !capabilities.timed_waitlist_offers;
                return (
                  <div key={key} className="flex items-start justify-between gap-6 py-4 first:pt-0 last:pb-0">
                    <div><p className="text-sm font-medium">{t(key)}</p><p className="mt-1 text-xs leading-5 text-muted">{t(`${key}_desc`)}</p></div>
                    <Switch isSelected={draft[key]} isDisabled={blocked} onValueChange={value => updateBoolean(key, value)} aria-label={t(key)} />
                  </div>
                );
              })}
            </Card.Content>
            <Card.Footer className="justify-end"><Button size="sm" variant="tertiary" startContent={<RotateCcw size={14} />} isDisabled={saving || !reason.trim()} onPress={() => void restore(section.keys)}>{t('restore_section')}</Button></Card.Footer>
          </Card>
        ))}

        <Card>
          <Card.Header><div><h2 className="text-base font-semibold">{t('advanced')}</h2><p className="text-sm text-muted">{t('advanced_desc')}</p></div></Card.Header>
          <Card.Content className="grid gap-5 md:grid-cols-2">
            <Select label={t('safety_enforcement_mode')} aria-label={t('safety_enforcement_mode')} selectedKeys={[draft.safety_enforcement_mode ?? 'global']} onSelectionChange={(keys) => { const value = Array.from(keys)[0]; setDraft({ ...draft, safety_enforcement_mode: value === 'global' ? null : value as EventConfiguration['safety_enforcement_mode'] }); }}>
              <SelectItem id="global">{t('use_platform_default')}</SelectItem><SelectItem id="off">{t('safety_off')}</SelectItem><SelectItem id="shadow">{t('safety_shadow')}</SelectItem><SelectItem id="enforce">{t('safety_enforce')}</SelectItem>
            </Select>
            <Select label={t('notification_delivery_mode')} aria-label={t('notification_delivery_mode')} selectedKeys={[draft.notification_delivery_mode ?? 'global']} onSelectionChange={(keys) => { const value = Array.from(keys)[0]; setDraft({ ...draft, notification_delivery_mode: value === 'global' ? null : value as EventConfiguration['notification_delivery_mode'] }); }}>
              <SelectItem id="global">{t('use_platform_default')}</SelectItem><SelectItem id="direct">{t('notifications_direct')}</SelectItem><SelectItem id="shadow_outbox">{t('notifications_shadow')}</SelectItem><SelectItem id="outbox_authoritative">{t('notifications_outbox')}</SelectItem>
            </Select>
          </Card.Content>
          <Card.Footer className="justify-end"><Button size="sm" variant="tertiary" startContent={<RotateCcw size={14} />} isDisabled={saving || !reason.trim()} onPress={() => void restore(['safety_enforcement_mode', 'notification_delivery_mode'])}>{t('restore_section')}</Button></Card.Footer>
        </Card>

        {hasFeature('event_attendance_credits') && (
          <Card>
            <Card.Header>
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold"><Gift size={18} />{t('rewards_title')}</h2>
                <p className="text-sm text-muted">{t('rewards_desc')}</p>
              </div>
            </Card.Header>
            <Card.Content className="grid gap-5 md:grid-cols-2">
              <Input
                label={t('rewards_monthly_cap')}
                description={t('rewards_monthly_cap_desc')}
                type="number"
                min={0.01}
                step={0.5}
                value={capText}
                onValueChange={(value) => {
                  setCapText(value);
                  const parsed = Number(value);
                  setDraft({
                    ...draft,
                    attendance_credit_monthly_cap: value.trim() === '' || !Number.isFinite(parsed) || parsed <= 0 ? null : parsed,
                  });
                }}
                aria-label={t('rewards_monthly_cap')}
              />
              <div className="flex flex-col justify-between gap-3 rounded-xl border border-border bg-surface-secondary p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{t('capability_attendance_credits')}</span>
                  <Chip size="sm" variant="soft" color={capabilities.attendance_credits ? 'success' : 'default'}>
                    {t(capabilities.attendance_credits ? 'available' : 'platform_off')}
                  </Chip>
                </div>
                <p className="text-xs leading-5 text-muted">{t('rewards_amounts_hint')}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => navigate(tenantPath('/admin/events/attendance-rewards'))}
                >
                  {t('rewards_open_ledger')}
                </Button>
              </div>
            </Card.Content>
            <Card.Footer className="justify-end">
              <Button size="sm" variant="tertiary" startContent={<RotateCcw size={14} />} isDisabled={saving || !reason.trim()} onPress={() => void restore(['attendance_credit_monthly_cap'])}>{t('restore_section')}</Button>
            </Card.Footer>
          </Card>
        )}

        <Card className="border-warning/40">
          <Card.Header><div><h2 className="flex items-center gap-2 text-base font-semibold"><ShieldCheck size={18} />{t('change_control')}</h2><p className="text-sm text-muted">{t('change_control_desc')}</p></div></Card.Header>
          <Card.Content><Textarea label={t('reason')} value={reason} onValueChange={setReason} minRows={3} placeholder={t('reason_placeholder')} aria-label={t('reason')} /></Card.Content>
          <Card.Footer className="flex flex-wrap justify-end gap-2">
            <Button variant="tertiary" startContent={<RotateCcw size={16} />} isDisabled={saving || !reason.trim()} onPress={() => void restore()}>{t('restore_defaults')}</Button>
            <Button startContent={<Save size={16} />} isPending={saving} isDisabled={!changed || !reason.trim()} onPress={save}>{t('save')}</Button>
          </Card.Footer>
        </Card>

        <Card>
          <Card.Header><div><h2 className="text-base font-semibold">{t('audit_title')}</h2><p className="text-sm text-muted">{t('audit_desc')}</p></div></Card.Header>
          <Card.Content>
            {auditEntries.length === 0 ? (
              <p className="py-4 text-sm text-muted">{t('audit_empty')}</p>
            ) : (
              <ol className="divide-y divide-border">
                {auditEntries.map(entry => (
                  <li key={entry.id} className="space-y-1 py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">{t(entry.action === 'events_configuration_defaults_restored' ? 'audit_restored' : 'audit_updated')}</p>
                      <time className="text-xs text-muted" dateTime={entry.created_at}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.created_at))}</time>
                    </div>
                    <p className="text-xs text-muted">{t('audit_actor_version', { actor: entry.actor_name ?? t('audit_unknown_actor'), version: entry.version })}</p>
                    {entry.reason ? <p className="text-sm">{entry.reason}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </Card.Content>
        </Card>
      </div>
    </div>
  );
}
