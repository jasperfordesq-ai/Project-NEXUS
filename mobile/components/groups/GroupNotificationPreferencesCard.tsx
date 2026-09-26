// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Card as HeroCard, Spinner, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import ErrorState from '@/components/ui/ErrorState';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import ChoiceChips, { toOptions } from '@/components/ui/ChoiceChips';
import Toggle from '@/components/ui/Toggle';
import { useAppToast } from '@/components/ui/AppToast';
import {
  getGroupNotificationPreferences,
  updateGroupNotificationPreferences,
  type GroupNotificationFrequency,
  type GroupNotificationPreferences,
} from '@/lib/api/groups';
import { describeApiError } from '@/lib/api/describeApiError';
import { useTheme } from '@/lib/hooks/useTheme';

const FREQUENCIES: readonly GroupNotificationFrequency[] = ['instant', 'digest', 'muted'];

export default function GroupNotificationPreferencesCard({
  groupId,
  refreshToken,
}: {
  groupId: number;
  refreshToken: number;
}) {
  const { t } = useTranslation(['groups', 'common']);
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const [preferences, setPreferences] = useState<GroupNotificationPreferences | null>(null);
  const [draft, setDraft] = useState<GroupNotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);
  const requestVersionRef = useRef(0);
  const savingRef = useRef(false);
  const translationRef = useRef(t);
  translationRef.current = t;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestVersionRef.current += 1;
    };
  }, []);

  const load = useCallback(async () => {
    const version = ++requestVersionRef.current;
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    try {
      const next = await getGroupNotificationPreferences(groupId);
      if (!mountedRef.current || version !== requestVersionRef.current) return;
      setPreferences(next);
      setDraft(next);
    } catch (error) {
      if (!mountedRef.current || version !== requestVersionRef.current) return;
      setPreferences(null);
      setDraft(null);
      setLoadError(describeApiError(error, translationRef.current('common:errors.loadFailedSubtitle')));
    } finally {
      if (mountedRef.current && version === requestVersionRef.current) setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  async function save() {
    if (!draft || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    const version = requestVersionRef.current;
    try {
      const saved = await updateGroupNotificationPreferences(groupId, {
        frequency: draft.frequency,
        email_enabled: draft.email_enabled,
        push_enabled: draft.push_enabled,
      });
      if (!mountedRef.current || version !== requestVersionRef.current) return;
      setPreferences(saved);
      setDraft(saved);
      showToast({ title: t('detail.notifications.saved'), variant: 'success' });
    } catch (error) {
      if (!mountedRef.current || version !== requestVersionRef.current) return;
      const message = describeApiError(error, t('detail.notifications.saveFailed'));
      setSaveError(message);
      showToast({ title: t('common:errors.alertTitle'), description: message, variant: 'danger' });
    } finally {
      savingRef.current = false;
      if (mountedRef.current && version === requestVersionRef.current) setSaving(false);
    }
  }

  const changed = Boolean(draft && preferences && (
    draft.frequency !== preferences.frequency
    || draft.email_enabled !== preferences.email_enabled
    || draft.push_enabled !== preferences.push_enabled
  ));

  return (
    <HeroCard className="rounded-panel p-0" testID="group-notification-preferences">
      <HeroCard.Body className="gap-4 p-4">
        <Text className="text-base font-semibold" style={{ color: theme.text }}>
          {t('detail.notifications.title')}
        </Text>
        {loading ? (
          <View className="min-h-[120px] items-center justify-center"><Spinner size="md" /></View>
        ) : loadError ? (
          <ErrorState subtitle={loadError} onRetry={() => void load()} isRetrying={loading} />
        ) : draft ? (
          <>
            <ChoiceChips<GroupNotificationFrequency>
              testID="group-notification-frequency"
              label={t('detail.notifications.frequencyLabel')}
              selected={draft.frequency}
              options={toOptions(FREQUENCIES, frequency => t(`detail.notifications.${frequency}`))}
              onSelect={frequency => {
                if (frequency) setDraft(current => current ? { ...current, frequency } : current);
              }}
            />
            <Toggle
              value={draft.email_enabled}
              disabled={saving || draft.frequency === 'muted'}
              onValueChange={email_enabled => setDraft(current => current ? { ...current, email_enabled } : current)}
              label={t('detail.notifications.email')}
            />
            <Toggle
              value={draft.push_enabled}
              disabled={saving || draft.frequency === 'muted'}
              onValueChange={push_enabled => setDraft(current => current ? { ...current, push_enabled } : current)}
              label={t('detail.notifications.push')}
            />
            {saveError ? (
              <Text accessibilityRole="alert" className="text-sm" style={{ color: theme.error }}>{saveError}</Text>
            ) : null}
            <HeroButton
              testID="group-notification-save"
              isDisabled={!changed || saving}
              onPress={() => void save()}
            >
              {saving ? <Spinner size="sm" /> : <HeroButton.Label>{t('common:buttons.save')}</HeroButton.Label>}
            </HeroButton>
          </>
        ) : null}
      </HeroCard.Body>
    </HeroCard>
  );
}
