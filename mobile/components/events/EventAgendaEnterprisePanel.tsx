// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { Ionicons } from '@/components/ui/Icon';
import { Button, Card, Chip } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import {
  registerEventAgendaSession,
  withdrawEventAgendaSession,
  type EventAgendaSession,
} from '@/lib/api/events';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { describeApiError } from '@/lib/api/describeApiError';

interface EventAgendaEnterprisePanelProps {
  eventId: number;
  session: EventAgendaSession;
  onSessionChange: (session: EventAgendaSession | null) => void;
}

function idempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();

  return `mobile-event-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function EventAgendaEnterprisePanel({
  eventId,
  session,
  onSessionChange,
}: EventAgendaEnterprisePanelProps) {
  const { t } = useTranslation('events');
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const [pending, setPending] = useState<'register' | 'withdraw' | null>(null);

  const mutate = async (action: 'register' | 'withdraw') => {
    if (pending !== null) return;
    setPending(action);
    try {
      const response = action === 'register'
        ? await registerEventAgendaSession(
            eventId,
            session.id,
            session.registration.version,
            idempotencyKey(),
          )
        : await withdrawEventAgendaSession(
            eventId,
            session.id,
            session.registration.version,
            idempotencyKey(),
          );
      onSessionChange(response.data.session);
      showToast({
        title: t(`agenda.enterprise.${action}SuccessTitle`),
        description: t(`agenda.enterprise.${action}SuccessDescription`),
        variant: 'success',
      });
    } catch (err) {
      showToast({
        title: t(`agenda.enterprise.${action}ErrorTitle`),
        description: describeApiError(err, t(`agenda.enterprise.${action}ErrorDescription`)),
        variant: 'danger',
      });
    } finally {
      setPending(null);
    }
  };

  const requestMutation = (action: 'register' | 'withdraw') => {
    if (action === 'register') {
      void mutate(action);
      return;
    }
    confirm({
      title: t('agenda.enterprise.withdrawConfirmTitle'),
      message: t('agenda.enterprise.withdrawConfirmDescription', { title: session.title }),
      confirmLabel: t('agenda.enterprise.withdraw'),
      cancelLabel: t('agenda.enterprise.keepRegistration'),
      variant: 'danger',
      onConfirm: () => mutate('withdraw'),
    });
  };

  const openResource = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch (err) {
      showToast({
        title: t('agenda.enterprise.resourceErrorTitle'),
        description: describeApiError(err, t('agenda.enterprise.resourceErrorDescription')),
        variant: 'danger',
      });
    }
  };

  return (
    <>
    <Card variant="secondary" className="mt-3" testID={`agenda-enterprise-${session.id}`}>
      <Card.Body className="gap-3 p-3">
        <View className="flex-row flex-wrap items-center gap-2">
          <Ionicons name="people-outline" size={16} color={theme.textSecondary} />
          <Text className="text-sm" style={{ color: theme.textSecondary }}>
            {session.capacity.limit === null
              ? t('agenda.enterprise.capacityUnlimited', { count: session.capacity.registered })
              : t('agenda.enterprise.capacityLimited', {
                  registered: session.capacity.registered,
                  limit: session.capacity.limit,
                })}
          </Text>
          {session.capacity.is_full ? (
            <Chip size="sm" variant="soft" color="warning">
              <Chip.Label>{t('agenda.enterprise.full')}</Chip.Label>
            </Chip>
          ) : null}
        </View>

        {session.resources.length > 0 ? (
          <View className="gap-2">
            <Text className="text-sm font-semibold" style={{ color: theme.text }}>
              {t('agenda.enterprise.resourcesTitle')}
            </Text>
            {session.resources.map((resource) => (
              <View key={resource.id} className="flex-row flex-wrap items-center gap-2">
                <Chip size="sm" variant="soft" color={resource.protected ? 'warning' : 'default'}>
                  <Chip.Label>{t(`agenda.enterprise.resourceType.${resource.type}`)}</Chip.Label>
                </Chip>
                {resource.url && resource.available ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    accessibilityLabel={t('agenda.enterprise.openResource', { title: resource.title })}
                    onPress={() => void openResource(resource.url!)}
                  >
                    <Button.Label>{resource.title}</Button.Label>
                    <Ionicons name="open-outline" size={14} color={primary} />
                  </Button>
                ) : (
                  <Text className="text-sm" style={{ color: theme.textSecondary }}>
                    {t('agenda.enterprise.resourceUnavailable', { title: resource.title })}
                  </Text>
                )}
              </View>
            ))}
          </View>
        ) : null}

        {session.registration.can_register ? (
          <Button
            size="sm"
            variant="primary"
            isDisabled={pending !== null}
            onPress={() => requestMutation('register')}
            testID={`agenda-register-${session.id}`}
          >
            <Button.Label>{pending === 'register' ? t('agenda.enterprise.registering') : t('agenda.enterprise.register')}</Button.Label>
          </Button>
        ) : null}
        {session.registration.can_withdraw ? (
          <Button
            size="sm"
            variant="outline"
            isDisabled={pending !== null}
            onPress={() => requestMutation('withdraw')}
            testID={`agenda-withdraw-${session.id}`}
          >
            <Button.Label>{pending === 'withdraw' ? t('agenda.enterprise.withdrawing') : t('agenda.enterprise.withdraw')}</Button.Label>
          </Button>
        ) : null}
        {session.registration.state === 'registered' ? (
          <Text className="text-sm font-medium" style={{ color: theme.success }}>
            {t('agenda.enterprise.registered')}
          </Text>
        ) : null}
        {session.registration.state === 'ineligible' ? (
          <Text className="text-sm" style={{ color: theme.textSecondary }}>
            {t('agenda.enterprise.ineligible')}
          </Text>
        ) : null}
      </Card.Body>
    </Card>
    {confirmDialog}
    </>
  );
}
