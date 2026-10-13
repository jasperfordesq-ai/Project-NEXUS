// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Bell from 'lucide-react/icons/bell';
import Plus from 'lucide-react/icons/plus';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import Save from 'lucide-react/icons/save';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import {
  eventsApi,
  type EventReminderPreferences,
  type EventReminderRule,
} from '@/lib/events-api';

const PRESETS = [10080, 1440, 60] as const;
const CHANNELS = ['email', 'in_app', 'web_push', 'fcm', 'realtime'] as const;
type Channel = typeof CHANNELS[number];

function ruleFor(offset: number): EventReminderRule {
  return {
    offset_minutes: offset,
    enabled: true,
    email_enabled: null,
    in_app_enabled: null,
    web_push_enabled: null,
    fcm_enabled: null,
    realtime_enabled: null,
  };
}

export function EventReminderPanel({ eventId }: { eventId: number }) {
  const { t } = useTranslation('events');
  const [preferences, setPreferences] = useState<EventReminderPreferences | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [rules, setRules] = useState<EventReminderRule[]>([]);
  const [channels, setChannels] = useState<Record<Channel, boolean>>({
    email: true,
    in_app: true,
    web_push: true,
    fcm: true,
    realtime: true,
  });
  const [customOffset, setCustomOffset] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  // The community can switch reminders off; the server then answers 403 and
  // there is nothing for the attendee to configure (E-104).
  const [unavailable, setUnavailable] = useState(false);

  const apply = useCallback((next: EventReminderPreferences) => {
    setPreferences(next);
    setEnabled(next.overrides.reminders_enabled ?? next.resolved.reminders_enabled);
    const effectiveRules = next.rules.length > 0
      ? next.rules
      : next.limits.default_offsets_minutes.map(ruleFor);
    setRules(effectiveRules);
    setChannels({
      email: next.overrides.email_enabled ?? next.resolved.channels.email,
      in_app: next.overrides.in_app_enabled ?? next.resolved.channels.in_app,
      web_push: next.overrides.web_push_enabled ?? next.resolved.channels.web_push,
      fcm: next.overrides.fcm_enabled ?? next.resolved.channels.fcm,
      realtime: next.overrides.realtime_enabled ?? next.resolved.channels.realtime,
    });
  }, []);

  const load = useCallback(async (conflict = false) => {
    setIsLoading(true);
    const response = await eventsApi.reminders(eventId);
    if (response.success && response.data) {
      apply(response.data);
      setMessage(conflict
        ? { tone: 'error', text: t('reminders.conflict_refreshed') }
        : null);
    } else if (response.code === 'FORBIDDEN' || response.code === 'HTTP_403') {
      setUnavailable(true);
    } else {
      setMessage({ tone: 'error', text: t('reminders.load_error') });
    }
    setIsLoading(false);
  }, [apply, eventId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedOffsets = useMemo(
    () => new Set(rules.filter((rule) => rule.enabled).map((rule) => rule.offset_minutes)),
    [rules],
  );

  const toggleOffset = (offset: number, selected: boolean) => {
    setRules((current) => {
      const remaining = current.filter((rule) => rule.offset_minutes !== offset);
      return selected ? [...remaining, ruleFor(offset)].sort((a, b) => b.offset_minutes - a.offset_minutes) : remaining;
    });
  };

  const addCustom = () => {
    if (!preferences) return;
    const offset = Number(customOffset);
    if (!Number.isInteger(offset)
      || offset < preferences.limits.minimum_offset_minutes
      || offset > preferences.limits.maximum_offset_minutes) {
      setMessage({
        tone: 'error',
        text: t('reminders.custom_bounds', {
          min: preferences.limits.minimum_offset_minutes,
          max: preferences.limits.maximum_offset_minutes,
        }),
      });
      return;
    }
    if (!selectedOffsets.has(offset) && rules.length >= preferences.limits.maximum_rules) {
      setMessage({ tone: 'error', text: t('reminders.rule_limit', { count: preferences.limits.maximum_rules }) });
      return;
    }
    toggleOffset(offset, true);
    setCustomOffset('');
    setMessage(null);
  };

  const save = async () => {
    if (!preferences) return;
    setIsSaving(true);
    setMessage(null);
    const response = await eventsApi.updateReminders(eventId, {
      expected_revision: preferences.revision,
      overrides: {
        ...preferences.overrides,
        reminders_enabled: enabled,
        cadence: enabled ? 'instant' : preferences.overrides.cadence,
        email_enabled: channels.email,
        in_app_enabled: channels.in_app,
        web_push_enabled: channels.web_push,
        fcm_enabled: channels.fcm,
        realtime_enabled: channels.realtime,
      },
      rules: rules.map((rule) => ({
        offset_minutes: rule.offset_minutes,
        enabled: rule.enabled,
        email_enabled: rule.email_enabled,
        in_app_enabled: rule.in_app_enabled,
        web_push_enabled: rule.web_push_enabled,
        fcm_enabled: rule.fcm_enabled,
        realtime_enabled: rule.realtime_enabled,
      })),
    });
    if (response.success && response.data) {
      apply(response.data);
      setMessage({ tone: 'success', text: t('reminders.saved') });
    } else if (response.code === 'VERSION_CONFLICT') {
      await load(true);
    } else {
      setMessage({ tone: 'error', text: t('reminders.save_error') });
    }
    setIsSaving(false);
  };

  const reset = async () => {
    if (!preferences) return;
    setIsSaving(true);
    const response = await eventsApi.deleteReminders(eventId, preferences.revision);
    if (response.success && response.data) {
      apply(response.data);
      setMessage({ tone: 'success', text: t('reminders.reset_success') });
    } else if (response.code === 'VERSION_CONFLICT') {
      await load(true);
    } else {
      setMessage({ tone: 'error', text: t('reminders.save_error') });
    }
    setIsSaving(false);
  };

  if (unavailable) {
    return null;
  }

  return (
    <Card className="mt-4 border border-theme-default bg-theme-elevated shadow-none">
      <CardBody className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-theme-primary">
              <Bell className="h-4 w-4" aria-hidden="true" />
              {t('reminders.title')}
            </h2>
            <p className="mt-1 text-sm text-theme-muted">{t('reminders.description')}</p>
          </div>
          <Switch
            aria-label={t('reminders.enabled_label')}
            isSelected={enabled}
            isDisabled={isLoading || isSaving}
            onValueChange={setEnabled}
          />
        </div>

        {message && (
          <div
            role={message.tone === 'error' ? 'alert' : 'status'}
            className={message.tone === 'error' ? 'rounded-lg bg-danger/10 p-3 text-sm text-danger' : 'rounded-lg bg-success/10 p-3 text-sm text-success'}
          >
            {message.text}
          </div>
        )}

        {!isLoading && preferences && (
          <>
            <fieldset className="space-y-2" disabled={!enabled || isSaving}>
              <legend className="text-sm font-medium text-theme-primary">{t('reminders.timing_legend')}</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {PRESETS.map((offset) => (
                  <Checkbox
                    key={offset}
                    isSelected={selectedOffsets.has(offset)}
                    onValueChange={(selected) => toggleOffset(offset, selected)}
                  >
                    {t(`reminders.offset_${offset}`)}
                  </Checkbox>
                ))}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <Input
                  type="number"
                  label={t('reminders.custom_minutes')}
                  value={customOffset}
                  min={preferences.limits.minimum_offset_minutes}
                  max={preferences.limits.maximum_offset_minutes}
                  onValueChange={setCustomOffset}
                />
                <Button variant="flat" startContent={<Plus className="h-4 w-4" />} onPress={addCustom}>
                  {t('reminders.add_custom')}
                </Button>
              </div>
              {rules.filter((rule) => !PRESETS.includes(rule.offset_minutes as typeof PRESETS[number])).map((rule) => (
                <Checkbox
                  key={rule.offset_minutes}
                  isSelected
                  onValueChange={(selected) => toggleOffset(rule.offset_minutes, selected)}
                >
                  {t('reminders.custom_value', { count: rule.offset_minutes })}
                </Checkbox>
              ))}
            </fieldset>

            <fieldset className="space-y-2" disabled={!enabled || isSaving}>
              <legend className="text-sm font-medium text-theme-primary">{t('reminders.channels_legend')}</legend>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {CHANNELS.map((channel) => (
                  <Switch
                    key={channel}
                    isSelected={channels[channel]}
                    onValueChange={(selected) => setChannels((current) => ({ ...current, [channel]: selected }))}
                  >
                    {t(`reminders.channel_${channel}`)}
                  </Switch>
                ))}
              </div>
            </fieldset>

            <p className="text-xs text-theme-muted">
              {t('reminders.resolved_explanation', {
                source: t(`reminders.source_${preferences.resolved.reminders_source}`, { defaultValue: preferences.resolved.reminders_source }),
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button isLoading={isSaving} startContent={<Save className="h-4 w-4" />} onPress={save}>
                {t('reminders.save')}
              </Button>
              <Button variant="flat" isDisabled={isSaving} startContent={<RotateCcw className="h-4 w-4" />} onPress={reset}>
                {t('reminders.reset')}
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
