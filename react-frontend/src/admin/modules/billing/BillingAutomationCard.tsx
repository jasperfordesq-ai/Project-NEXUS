// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BillingAutomationCard
 * The platform team's controls for the daily billing check: the master
 * switch, the day counts, the member-limit warning and what happens over the
 * limit, and the "What would happen today" list.
 *
 * The switch is off until the platform team turns it on. While it is off the
 * check sends nothing and pauses nobody, and the list below still says what
 * it would do: reading that list is how the switch is meant to be turned on.
 *
 * 🔴 The types are the SERVER's shape (BillingSettings::all() and
 * BillingAutomationService::preview()), pinned by
 * tests/Laravel/Feature/Billing/BillingAutomationEndpointsTest.php.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CalendarClock from 'lucide-react/icons/calendar-clock';
import { Button, Card, CardBody, CardHeader, Input, Radio, RadioGroup, Spinner, Switch } from '@/components/ui';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, formatNumber } from '@/lib/helpers';
import {
  OVER_LIMIT_ACTIONS,
  isOverLimitAction,
  overLimitExplanation,
  overLimitLabel,
  usesDays,
  type OverLimitAction,
} from './OverLimitRuleDialog';

/** GET /v2/admin/super/billing/settings */
interface BillingAutomationSettings {
  automation_enabled: boolean;
  /** Days before the paid-until date, largest first, e.g. "30,14,7,1"; "" sends none. */
  reminder_days: string;
  final_warning_days_late: number;
  suspend_days_late: number;
  /** A card payer Stripe is still retrying is paused once this many days late. */
  card_retry_max_days_late: number;
  limit_warning_percent: number;
  over_limit_action: OverLimitAction;
  over_limit_grace_days: number;
}

type NumberKey = Exclude<keyof BillingAutomationSettings, 'automation_enabled' | 'over_limit_action' | 'reminder_days'>;

/** One entry of GET /v2/admin/super/billing/standing/preview */
/** GET /v2/admin/super/billing/standing/last-run. `at` is null when the check has never run. */
interface LastRun {
  at: string | null;
  result: 'ok' | 'off' | 'failed' | null;
  actions: number;
}

interface PreviewEntry {
  tenant_id: number;
  tenant_name: string;
  clock: 'payment' | 'member_limit';
  action: string;
  detail: Record<string, unknown>;
}

/** The form holds what the person typed; numbers are converted on save. */
type Draft = Omit<BillingAutomationSettings, NumberKey> & Record<NumberKey, string>;

const NUMBER_KEYS: NumberKey[] = [
  'final_warning_days_late',
  'suspend_days_late',
  'card_retry_max_days_late',
  'limit_warning_percent',
  'over_limit_grace_days',
];

/** Every action the check can name, by clock. Anything else is "another action". */
const KNOWN_ACTIONS: Record<PreviewEntry['clock'], string[]> = {
  payment: ['reminder', 'due', 'final_warning', 'suspend', 'waiting_for_stripe'],
  member_limit: ['approaching', 'reached', 'over', 'suspend', 'restore', 'move_up', 'needs_decision'],
};

function toDraft(settings: BillingAutomationSettings): Draft {
  return {
    automation_enabled: settings.automation_enabled,
    over_limit_action: settings.over_limit_action,
    reminder_days: settings.reminder_days,
    final_warning_days_late: String(settings.final_warning_days_late),
    suspend_days_late: String(settings.suspend_days_late),
    card_retry_max_days_late: String(settings.card_retry_max_days_late),
    limit_warning_percent: String(settings.limit_warning_percent),
    over_limit_grace_days: String(settings.over_limit_grace_days),
  };
}

/**
 * Only what differs from the saved settings. A number that is not a whole
 * number is sent as typed, so the server refuses it in its own words rather
 * than this screen guessing a value.
 */
function changes(saved: BillingAutomationSettings, draft: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (draft.automation_enabled !== saved.automation_enabled) out.automation_enabled = draft.automation_enabled;
  if (draft.over_limit_action !== saved.over_limit_action) out.over_limit_action = draft.over_limit_action;
  // Sent exactly as typed: the server normalises it ("7, 30,14" → "30,14,7")
  // or refuses it in its own words.
  if (draft.reminder_days !== saved.reminder_days) out.reminder_days = draft.reminder_days;
  for (const key of NUMBER_KEYS) {
    const typed = draft[key].trim();
    if (typed === String(saved[key])) continue;
    out[key] = /^\d+$/.test(typed) ? Number(typed) : typed;
  }
  return out;
}

const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const count = (value: unknown): string => (typeof value === 'number' ? formatNumber(value) : text(value));

/** Why the daily check cannot move a community up by itself (moveOutcome()). */
const DECISION_REASONS: readonly string[] = ['no_plan_fits', 'custom_price', 'card_subscription'];
const dateText = (value: unknown): string => (typeof value === 'string' && value !== '' ? formatDate(value) : '');

interface BillingAutomationCardProps {
  /**
   * Told the saved member-limit warning percent, on load and after each save,
   * so the Billing control table colours usage by the same number the daily
   * check warns at.
   */
  onWarningPercent?: (percent: number) => void;
}

export function BillingAutomationCard({ onWarningPercent }: BillingAutomationCardProps = {}) {
  const { t } = useTranslation('admin_billing');
  const toast = useToast();

  const [saved, setSaved] = useState<BillingAutomationSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const [preview, setPreview] = useState<PreviewEntry[] | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);

  const loadPreview = useCallback(async () => {
    const response = await api.get<PreviewEntry[]>('/v2/admin/super/billing/standing/preview');
    if (response.success && Array.isArray(response.data)) {
      setPreview(response.data);
      setPreviewFailed(false);
    } else {
      setPreviewFailed(true);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const response = await api.get<BillingAutomationSettings>('/v2/admin/super/billing/settings');
      if (!alive) return;
      if (response.success && response.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
        setSaved(response.data);
        setDraft(toDraft(response.data));
      } else {
        setLoadFailed(true);
      }
    })();
    void loadPreview();
    void (async () => {
      const response = await api.get<LastRun>('/v2/admin/super/billing/standing/last-run');
      if (alive && response.success && response.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
        setLastRun(response.data);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadPreview]);

  useEffect(() => {
    if (saved && typeof saved.limit_warning_percent === 'number') {
      onWarningPercent?.(saved.limit_warning_percent);
    }
  }, [saved, onWarningPercent]);

  const pending = useMemo(() => (saved && draft ? changes(saved, draft) : {}), [saved, draft]);
  const hasChanges = Object.keys(pending).length > 0;

  const setNumber = (key: NumberKey) => (value: string) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const save = async () => {
    if (!hasChanges) return;
    setSaving(true);
    const response = await api.put<BillingAutomationSettings>('/v2/admin/super/billing/settings', pending);
    setSaving(false);

    if (response.success && response.data) {
      setSaved(response.data);
      setDraft(toDraft(response.data));
      toast.success(t('automation.saved'));
      void loadPreview();
      return;
    }

    // The server says which rule was broken, in the reader's language. The
    // draft stays on screen so it can be corrected.
    // admin-i18n-ignore: localized server message — AdminSuperController::updateBillingAutomationSettings refusals (lang/*/api.php)
    toast.error(response.error || t('automation.save_failed'));
  };

  const describe = (entry: PreviewEntry): string => {
    const known = KNOWN_ACTIONS[entry.clock]?.includes(entry.action) ?? false;
    if (!known) return t('automation.action_other');

    const d = entry.detail ?? {};
    if (entry.clock === 'member_limit' && entry.action === 'needs_decision') {
      const reason = DECISION_REASONS.includes(String(d.decision_reason)) ? String(d.decision_reason) : 'no_plan_fits';
      return t('automation.action_member_limit_needs_decision', { reason: t(`automation.decision_${reason}`) });
    }

    return t(`automation.action_${entry.clock}_${entry.action}`, {
      date: dateText(d.paid_until),
      days: text(d.days_late),
      pause_date: dateText(d.pause_date),
      // Figures in the reader's number format, never raw digits.
      used: count(d.active_members),
      max: count(d.max_users),
      percent: text(d.percent),
      plan: text(d.move_plan),
    });
  };

  return (
    <Card>
      <CardHeader className="flex items-center gap-2 pb-0">
        <CalendarClock size={18} className="text-accent" aria-hidden="true" />
        <span className="font-semibold text-sm">{t('automation.title')}</span>
      </CardHeader>
      <CardBody className="flex flex-col gap-6">
        {loadFailed ? (
          <p role="alert" className="text-sm text-danger">{t('automation.load_failed')}</p>
        ) : !draft ? (
          <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4">
            <Spinner size="md" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Label and its note beside the switch, as the other admin
                switches are laid out (Translation settings). */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">{t('automation.switch_label')}</p>
                <p className="text-sm text-muted">
                  {draft.automation_enabled ? t('automation.on_note') : t('automation.off_note')}
                </p>
                {/* When the morning check last ran, and how it went. There
                    was no way to tell it had run at all. */}
                {lastRun ? (
                  <p
                    data-testid="billing-last-run"
                    role={lastRun.result === 'failed' ? 'alert' : undefined}
                    className={`text-sm ${lastRun.result === 'failed' ? 'font-semibold text-danger' : 'text-muted'}`}
                  >
                    {lastRun.at === null
                      ? t('automation.last_run_never')
                      : lastRun.result === 'failed'
                        ? t('automation.last_run_failed', { date: formatDateTime(lastRun.at) })
                        : lastRun.result === 'off'
                          ? t('automation.last_run_off', { date: formatDateTime(lastRun.at) })
                          : t('automation.last_run_ok', { date: formatDateTime(lastRun.at), actions: formatNumber(lastRun.actions) })}
                  </p>
                ) : null}
              </div>
              <Switch
                aria-label={t('automation.switch_label')}
                className="flex-shrink-0"
                isSelected={draft.automation_enabled}
                onValueChange={(value) => setDraft({ ...draft, automation_enabled: value })}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label={t('automation.reminder_days')}
                description={t('automation.reminder_days_help')}
                value={draft.reminder_days}
                onValueChange={(value) => setDraft((current) => (current ? { ...current, reminder_days: value } : current))}
              />
              <Input
                label={t('automation.final_warning_days_late')}
                type="number"
                min={1}
                max={180}
                value={draft.final_warning_days_late}
                onValueChange={setNumber('final_warning_days_late')}
              />
              <Input
                label={t('automation.suspend_days_late')}
                type="number"
                min={1}
                max={365}
                value={draft.suspend_days_late}
                onValueChange={setNumber('suspend_days_late')}
              />
              <Input
                label={t('automation.card_retry_max_days_late')}
                description={t('automation.card_retry_help')}
                type="number"
                min={1}
                max={180}
                value={draft.card_retry_max_days_late}
                onValueChange={setNumber('card_retry_max_days_late')}
              />
              <Input
                label={t('automation.limit_warning_percent')}
                type="number"
                min={50}
                max={99}
                value={draft.limit_warning_percent}
                onValueChange={setNumber('limit_warning_percent')}
                endContent={<span className="text-muted text-sm">%</span>}
              />
            </div>

            {/* The platform default: a hub's default or a community's own rule wins over it. */}
            <RadioGroup
              label={t('automation.over_limit_label')}
              value={draft.over_limit_action}
              onValueChange={(value) => {
                if (isOverLimitAction(value)) setDraft({ ...draft, over_limit_action: value });
              }}
            >
              {OVER_LIMIT_ACTIONS.map((action) => (
                <Radio key={action} value={action} description={overLimitExplanation(t, action)}>
                  {overLimitLabel(t, action)}
                </Radio>
              ))}
            </RadioGroup>

            {usesDays(draft.over_limit_action) ? (
              <Input
                className="sm:max-w-xs"
                label={t('automation.over_limit_days')}
                type="number"
                min={1}
                max={365}
                value={draft.over_limit_grace_days}
                onValueChange={setNumber('over_limit_grace_days')}
              />
            ) : null}

            <div className="flex justify-end">
              <Button onPress={() => void save()} isLoading={saving} isDisabled={!hasChanges || saving}>
                {t('automation.save')}
              </Button>
            </div>
          </div>
        )}

        <section className="flex flex-col gap-2" aria-labelledby="billing-automation-preview-title">
          <h3 id="billing-automation-preview-title" className="text-sm font-semibold">
            {t('automation.preview_title')}
          </h3>
          {previewFailed ? (
            <p role="alert" className="text-sm text-danger">{t('automation.preview_failed')}</p>
          ) : preview === null ? (
            <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-2">
              <Spinner size="sm" />
            </div>
          ) : preview.length === 0 ? (
            <p className="text-sm text-muted">{t('automation.preview_empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {preview.map((entry) => (
                <li
                  key={`${entry.tenant_id}-${entry.clock}-${entry.action}`}
                  className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:gap-3"
                >
                  <span className="text-sm font-medium sm:w-1/4">{entry.tenant_name}</span>
                  <span className="text-xs text-muted sm:w-1/6">
                    {entry.clock === 'payment' ? t('automation.clock_payment') : t('automation.clock_member_limit')}
                  </span>
                  <span className="text-sm break-normal">{describe(entry)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardBody>
    </Card>
  );
}

export default BillingAutomationCard;
