// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@/components/ui/Icon';
import { Alert, Button, Card, Chip, Spinner } from 'heroui-native';
import { useTranslation } from 'react-i18next';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import {
  acknowledgeEventCode,
  getEventSafety,
  requestEventGuardianConsent,
  withdrawEventCode,
  withdrawEventGuardianConsent,
  type EventSafety,
  type GuardianRelationship,
} from '@/lib/api/eventSafety';
import { useApi } from '@/lib/hooks/useApi';
import type { Theme } from '@/lib/hooks/useTheme';

const RELATIONSHIPS: GuardianRelationship[] = ['parent', 'guardian', 'legal_guardian', 'carer'];

function mutationKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface EventSafetyCardProps {
  eventId: number;
  primary: string;
  theme: Theme;
  refreshSignal?: number;
}

export default function EventSafetyCard({
  eventId,
  primary,
  theme,
  refreshSignal = 0,
}: EventSafetyCardProps) {
  const { t, i18n } = useTranslation('eventSafety');
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const safetyApi = useApi(() => getEventSafety(eventId), [eventId], { enabled: eventId > 0 });
  const [safetyOverride, setSafetyOverride] = useState<EventSafety | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [hasReadCode, setHasReadCode] = useState(false);
  const [guardianName, setGuardianName] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');
  const [relationship, setRelationship] = useState<GuardianRelationship>('parent');

  useEffect(() => {
    setSafetyOverride(null);
    setHasReadCode(false);
  }, [eventId]);

  useEffect(() => {
    if (refreshSignal > 0) safetyApi.refresh();
    // refresh is stable within useApi; the signal is the intentional trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const safety = safetyOverride ?? safetyApi.data?.data ?? null;

  async function mutate(action: string, request: () => Promise<{ data: EventSafety }>): Promise<boolean> {
    setPendingAction(action);
    try {
      const response = await request();
      setSafetyOverride(response.data);
      setHasReadCode(false);
      showToast({
        title: t(`safety.attendee.success.${action}`),
        variant: 'success',
      });
      return true;
    } catch {
      showToast({
        title: t('safety.attendee.action_error'),
        variant: 'danger',
      });
      return false;
    } finally {
      setPendingAction(null);
    }
  }

  async function acknowledgeCode() {
    const code = safety?.requirements?.version.code_of_conduct;
    if (!code?.text_version || !code.text_hash || !hasReadCode) return;
    await mutate('acknowledge', () => acknowledgeEventCode(
      eventId,
      code.text_version as string,
      code.text_hash as string,
      mutationKey('event-safety-code'),
    ));
  }

  function withdrawCode() {
    const acknowledgementId = safety?.evidence.code_of_conduct.acknowledgement_id;
    if (!acknowledgementId) return;
    confirm({
      title: t('safety.confirmations.withdraw_code_title'),
      message: t('safety.confirmations.withdraw_code_body'),
      confirmLabel: t('safety.actions.withdraw_acknowledgement'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        await mutate('withdraw_code', () => withdrawEventCode(
          eventId,
          acknowledgementId,
          mutationKey('event-safety-code-withdraw'),
        ));
      },
    });
  }

  async function requestGuardian() {
    if (!guardianName.trim() || !guardianEmail.trim()) return;
    const completed = await mutate('request_guardian', () => requestEventGuardianConsent(
      eventId,
      {
        guardianName: guardianName.trim(),
        guardianEmail: guardianEmail.trim(),
        relationship,
        preferredLanguage: i18n.resolvedLanguage ?? i18n.language ?? 'en',
      },
      mutationKey('event-safety-guardian'),
    ));
    if (completed) {
      setGuardianName('');
      setGuardianEmail('');
    }
  }

  function withdrawGuardian() {
    const consentId = safety?.evidence.guardian_consent.consent_id;
    if (!consentId) return;
    confirm({
      title: t('safety.confirmations.withdraw_guardian_title'),
      message: t('safety.confirmations.withdraw_guardian_body'),
      confirmLabel: t('safety.actions.withdraw_guardian_consent'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        await mutate('withdraw_guardian', () => withdrawEventGuardianConsent(
          eventId,
          consentId,
          mutationKey('event-safety-guardian-withdraw'),
        ));
      },
    });
  }

  if (safetyApi.isLoading && !safety) {
    return (
      <Card variant="secondary">
        <Card.Body className="min-h-28 items-center justify-center px-4 py-4">
          <Spinner accessibilityLabel={t('safety.attendee.loading')} />
        </Card.Body>
      </Card>
    );
  }

  if (safetyApi.error && !safety) {
    return (
      <Card variant="secondary">
        <Card.Body className="gap-3 px-4 py-4">
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{t('safety.attendee.load_error_title')}</Alert.Title>
              <Alert.Description>{t('safety.attendee.load_error_description')}</Alert.Description>
            </Alert.Content>
          </Alert>
          <Button variant="secondary" onPress={safetyApi.refresh}>
            {t('safety.actions.retry')}
          </Button>
        </Card.Body>
      </Card>
    );
  }

  if (!safety || (safety.requirements === null && safety.rollout.mode === 'off')) return null;

  const code = safety.requirements?.version.code_of_conduct;
  const codeEvidence = safety.evidence.code_of_conduct;
  const guardianEvidence = safety.evidence.guardian_consent;
  const blocked = safety.eligibility.status === 'deny' || safety.eligibility.status === 'unavailable';

  return (
    <>
    <Card variant="secondary" testID="event-safety-card">
      <Card.Body className="gap-4 px-4 py-4">
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1 gap-1">
            <View className="flex-row items-center gap-2">
              <Ionicons name="shield-checkmark-outline" size={20} color={primary} />
              <Card.Title>{t('safety.attendee.title')}</Card.Title>
            </View>
            <Card.Description>{t('safety.attendee.description')}</Card.Description>
          </View>
          <Chip size="sm" variant="soft" color={blocked ? 'warning' : 'success'}>
            <Chip.Label>{t(`safety.eligibility.${safety.eligibility.status}`)}</Chip.Label>
          </Chip>
        </View>

        {safety.evidence.active_denial ? (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{t('safety.attendee.denial_title')}</Alert.Title>
              <Alert.Description>{t(`safety.reasons.${safety.evidence.active_denial.reason_code}`)}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}

        {safety.eligibility.status !== 'allow' && safety.eligibility.reason_codes.length > 0 ? (
          <View className="gap-2 rounded-xl border border-warning/30 bg-warning/5 p-3">
            <Text className="font-semibold" style={{ color: theme.text }}>{t('safety.attendee.attention_title')}</Text>
            {safety.eligibility.reason_codes.map((reason) => (
              <Text key={reason} className="text-sm" style={{ color: theme.textSecondary }}>
                {'• '}{t(`safety.reasons.${reason}`, { defaultValue: t('safety.reasons.unknown') })}
              </Text>
            ))}
          </View>
        ) : null}

        {code?.required ? (
          <View className="gap-3 border-t border-border pt-4">
            <View className="flex-row items-center justify-between gap-3">
              <Text className="font-semibold" style={{ color: theme.text }}>{t('safety.code.title')}</Text>
              <Chip size="sm" variant="soft" color={codeEvidence.status === 'acknowledged' ? 'success' : 'warning'}>
                <Chip.Label>{t(`safety.code.status.${codeEvidence.status}`)}</Chip.Label>
              </Chip>
            </View>
            <ScrollView
              className="max-h-64 rounded-xl border border-border bg-surface-secondary p-3"
              contentContainerClassName="pb-3"
              nestedScrollEnabled
              showsVerticalScrollIndicator
              testID="event-safety-code-scroll"
            >
              <Text selectable className="text-sm leading-5" style={{ color: theme.text }}>{code.text}</Text>
            </ScrollView>
            {safety.permissions.acknowledge_code_of_conduct ? (
              <View className="gap-3">
                <Checkbox
                  checked={hasReadCode}
                  onPress={() => setHasReadCode((value) => !value)}
                  label={t('safety.code.confirm_read')}
                  disabled={pendingAction !== null}
                />
                <Button
                  variant="primary"
                  isDisabled={!hasReadCode || pendingAction !== null}
                  onPress={() => void acknowledgeCode()}
                  style={{ backgroundColor: primary }}
                >
                  {pendingAction === 'acknowledge' ? <Spinner size="sm" /> : null}
                  <Button.Label>{t('safety.actions.acknowledge')}</Button.Label>
                </Button>
              </View>
            ) : null}
            {safety.permissions.withdraw_code_of_conduct ? (
              <Button
                variant="secondary"
                isDisabled={pendingAction !== null}
                onPress={withdrawCode}
              >
                {pendingAction === 'withdraw_code' ? <Spinner size="sm" /> : null}
                <Button.Label>{t('safety.actions.withdraw_acknowledgement')}</Button.Label>
              </Button>
            ) : null}
          </View>
        ) : null}

        {guardianEvidence.status !== 'not_required' ? (
          <View className="gap-3 border-t border-border pt-4">
            <View className="flex-row items-center justify-between gap-3">
              <Text className="font-semibold" style={{ color: theme.text }}>{t('safety.guardian.title')}</Text>
              <Chip size="sm" variant="soft" color={guardianEvidence.status === 'active' ? 'success' : 'warning'}>
                <Chip.Label>{t(`safety.guardian.status.${guardianEvidence.status}`)}</Chip.Label>
              </Chip>
            </View>
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
              {t('safety.guardian.description')}
            </Text>
            {safety.permissions.request_guardian_consent ? (
              <View className="gap-1">
                <Input
                  label={t('safety.guardian.name_label')}
                  value={guardianName}
                  onChangeText={setGuardianName}
                  maxLength={191}
                  autoCapitalize="words"
                />
                <Input
                  label={t('safety.guardian.email_label')}
                  value={guardianEmail}
                  onChangeText={setGuardianEmail}
                  maxLength={254}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text className="mb-1 text-sm font-semibold" style={{ color: theme.text }}>
                  {t('safety.guardian.relationship_label')}
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {RELATIONSHIPS.map((value) => (
                    <Button
                      key={value}
                      size="sm"
                      variant={relationship === value ? 'primary' : 'secondary'}
                      onPress={() => setRelationship(value)}
                    >
                      {t(`safety.guardian.relationships.${value}`)}
                    </Button>
                  ))}
                </View>
                <Text className="my-2 text-xs leading-4" style={{ color: theme.textMuted }}>
                  {t('safety.guardian.privacy_notice')}
                </Text>
                <Button
                  variant="primary"
                  isDisabled={!guardianName.trim() || !guardianEmail.trim() || pendingAction !== null}
                  onPress={() => void requestGuardian()}
                  style={{ backgroundColor: primary }}
                >
                  {pendingAction === 'request_guardian' ? <Spinner size="sm" /> : null}
                  <Button.Label>{t('safety.actions.request_guardian_consent')}</Button.Label>
                </Button>
              </View>
            ) : null}
            {safety.permissions.withdraw_guardian_consent ? (
              <Button
                variant="secondary"
                isDisabled={pendingAction !== null}
                onPress={withdrawGuardian}
              >
                {pendingAction === 'withdraw_guardian' ? <Spinner size="sm" /> : null}
                <Button.Label>{t('safety.actions.withdraw_guardian_consent')}</Button.Label>
              </Button>
            ) : null}
          </View>
        ) : null}
      </Card.Body>
    </Card>
    {confirmDialog}
    </>
  );
}
