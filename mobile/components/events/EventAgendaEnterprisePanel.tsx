// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { Ionicons } from '@/components/ui/Icon';
import { Card } from 'heroui-native';
import { Button } from '@/components/ui/NativeButton';
import { Chip } from '@/components/ui/StatusChip';
import { useTranslation } from 'react-i18next';

import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import { type EventAgendaSession } from '@/lib/api/events';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useAuth } from '@/lib/hooks/useAuth';
import { useEventSessionOperations } from '@/lib/hooks/useEventSessionOperations';
import { useTheme } from '@/lib/hooks/useTheme';
import { describeApiError } from '@/lib/api/describeApiError';

interface EventAgendaEnterprisePanelProps {
  eventId: number;
  session: EventAgendaSession;
  onSessionChange: (session: EventAgendaSession | null) => void;
}

export function EventAgendaEnterprisePanel(props: EventAgendaEnterprisePanelProps) {
  const { user } = useAuth();
  const { tenant } = useTenant();
  return <SessionPanel key={`${tenant?.id}:${user?.id}:${props.eventId}:${props.session.id}`} {...props}
    tenantId={Number(tenant?.id)} userId={Number(user?.id)} />;
}

function SessionPanel({
  eventId,
  session,
  onSessionChange,
  tenantId, userId,
}: EventAgendaEnterprisePanelProps & { tenantId: number; userId: number }) {
  const { t } = useTranslation(['events', 'event_communications', 'common']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const [pending, setPending] = useState<'register' | 'withdraw' | null>(null);
  const mounted = useRef(true);
  const locked = useRef(false);
  const actionRef = useRef<'register' | 'withdraw' | null>(null);
  const current = useRef({ eventId, session });
  current.current = { eventId, session };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const operation = useEventSessionOperations({ tenantId, userId, eventId, sessionId: session.id },
    [tenantId, userId, eventId, session.id].every(id => Number.isSafeInteger(id) && id > 0), response => {
      if (response.data.registration_version < current.current.session.registration.version) return;
      onSessionChange(response.data.session);
      const action = actionRef.current;
      if (action && response.data.session?.registration.state === (action === 'register' ? 'registered' : 'withdrawn')) {
        showToast({ title: t(`agenda.enterprise.${action}SuccessTitle`),
          description: t(`agenda.enterprise.${action}SuccessDescription`), variant: 'success' });
      }
    });

  const mutate = async (action: 'register' | 'withdraw') => {
    const stillCurrent = () => mounted.current && current.current.eventId === eventId
      && current.current.session.id === session.id
      && current.current.session.registration.version === session.registration.version;
    if (!stillCurrent() || locked.current || operation.blocked || !current.current.session.registration[action === 'register' ? 'can_register' : 'can_withdraw']) return;
    locked.current = true;
    actionRef.current = action;
    setPending(action);
    try {
      await operation.submit({ action, expectedVersion: session.registration.version });
    } catch (err) {
      if (!stillCurrent()) return;
      showToast({
        title: t(`agenda.enterprise.${action}ErrorTitle`),
        description: describeApiError(err, t(`agenda.enterprise.${action}ErrorDescription`)),
        variant: 'danger',
      });
    } finally {
      locked.current = false;
      if (mounted.current) setPending(null);
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
        {operation.storageFailed || operation.saved?.status === 'pending' ? <View className="gap-2">
          <Text accessibilityRole="header" className="font-semibold text-foreground">{t(`event_communications:${operation.storageFailed ? 'recovery_storage_title' : 'recovery_title'}`)}</Text>
          <Text className="text-foreground">{t(`event_communications:${operation.storageFailed ? 'recovery_storage_description' : 'recovery_description'}`)}</Text>
          {operation.operationFailed ? <Text accessibilityRole="alert" className="text-danger">{t('common:errors.generic')}</Text> : null}
          <Button isDisabled={operation.busy} onPress={() => {
            if (operation.storageFailed) void operation.reload();
            else {
              actionRef.current = operation.saved?.intent.action ?? null;
              void operation.submit().catch(() => undefined);
            }
          }}><Button.Label>{t(`event_communications:${operation.storageFailed ? 'recovery_reload' : 'recovery_button'}`)}</Button.Label></Button>
        </View> : null}
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
            isDisabled={pending !== null || operation.blocked}
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
            isDisabled={pending !== null || operation.blocked}
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
