// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface } from 'heroui-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { cancelGroupExchange, completeGroupExchange, confirmGroupExchange, getGroupExchange, type GroupExchangeParticipant, type GroupExchangeStatus } from '@/lib/api/groupExchanges';
import { useAuth } from '@/lib/hooks/useAuth';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { dateLocale } from '@/lib/utils/dateLocale';
import { describeApiError } from '@/lib/api/describeApiError';

const statusTones: Record<GroupExchangeStatus, string> = {
  draft: '#64748b',
  pending_participants: '#f59e0b',
  pending_broker: '#8b5cf6',
  active: '#0ea5e9',
  pending_confirmation: '#f59e0b',
  completed: '#22c55e',
  cancelled: '#ef4444',
  disputed: '#ef4444',
};

function formatDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function GroupExchangeDetailScreen() {
  return (
    <ModalErrorBoundary>
      <GroupExchangeDetailScreenInner />
    </ModalErrorBoundary>
  );
}

function GroupExchangeDetailScreenInner() {
  const { t } = useTranslation(['exchanges', 'common']);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const [submitting, setSubmitting] = useState(false);

  const exchangeId = Number(id);
  const safeExchangeId = Number.isFinite(exchangeId) && exchangeId > 0 ? exchangeId : 0;
  const { data, isLoading, error, refresh } = useApi(() => getGroupExchange(safeExchangeId), [safeExchangeId], { enabled: safeExchangeId > 0 });
  const exchange = data?.data ?? null;

  async function runAction(action: 'confirm' | 'complete' | 'cancel') {
    if (!exchange) return;
    setSubmitting(true);
    try {
      if (action === 'confirm') {
        await confirmGroupExchange(exchange.id);
      } else if (action === 'complete') {
        await completeGroupExchange(exchange.id);
      } else {
        await cancelGroupExchange(exchange.id);
      }
      await refresh();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t(`groupExchanges.detail.actions.${action}Failed`)), variant: 'danger' });
    } finally {
      setSubmitting(false);
    }
  }

  function confirmCancel() {
    confirm({
      title: t('groupExchanges.detail.actions.cancelTitle'),
      message: t('groupExchanges.detail.actions.cancelDescription'),
      confirmLabel: t('groupExchanges.detail.actions.cancel'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: () => runAction('cancel'),
    });
  }

  if (safeExchangeId <= 0) {
    return (
      <ScreenShell title={t('groupExchanges.detail.title')} backLabel={t('common:buttons.back')}>
        <EmptyState icon="warning-outline" title={t('groupExchanges.detail.invalidTitle')} subtitle={t('groupExchanges.detail.invalidDescription')} />
      </ScreenShell>
    );
  }

  if (isLoading && !exchange) {
    return (
      <ScreenShell title={t('groupExchanges.detail.title')} backLabel={t('common:buttons.back')}>
        <View className="flex-1 items-center justify-center"><Spinner size="lg" /></View>
      </ScreenShell>
    );
  }

  if (error || !exchange) {
    return (
      <ScreenShell title={t('groupExchanges.detail.title')} backLabel={t('common:buttons.back')}>
        <EmptyState icon="warning-outline" title={t('groupExchanges.detail.notFoundTitle')} subtitle={t('groupExchanges.detail.notFoundDescription')} />
      </ScreenShell>
    );
  }

  const tone = statusTones[exchange.status] ?? primary;
  const participants = exchange.participants ?? [];
  const currentParticipant = participants.find((participant) => participant.user_id === user?.id);
  const isOrganizer = exchange.organizer_id === user?.id;
  const allConfirmed = participants.length > 0 && participants.every((participant) => participant.confirmed);
  const canConfirm = exchange.status === 'pending_confirmation' && Boolean(currentParticipant) && !currentParticipant?.confirmed;
  const canComplete = isOrganizer && exchange.status === 'pending_confirmation' && allConfirmed;
  const canCancel = isOrganizer && !['completed', 'cancelled'].includes(exchange.status);
  const createdDate = formatDate(exchange.created_at);

  return (
    <ScreenShell title={t('groupExchanges.detail.title')} backLabel={t('common:buttons.back')} refreshing={isLoading} onRefresh={refresh}>
      <HeroCard className="mb-4 overflow-hidden rounded-panel p-0">
        <View className="h-1.5" style={{ backgroundColor: tone }} />
        <HeroCard.Body className="gap-3 p-4">
          <View className="flex-row items-start gap-3">
            <View className="h-11 w-11 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(tone, 0.14) }}>
              <Ionicons name="swap-horizontal-outline" size={22} color={tone} />
            </View>
            <View className="min-w-0 flex-1 gap-1">
              <Text className="text-2xl font-bold leading-8" style={{ color: theme.text }}>{exchange.title}</Text>
              <Text className="text-sm" style={{ color: theme.textSecondary }}>
                {t('groupExchanges.detail.created', { date: createdDate || t('groupExchanges.detail.unknownDate') })}
              </Text>
            </View>
            <Chip size="sm" variant="secondary"><Chip.Label>{t(`groupExchanges.status.${exchange.status}`)}</Chip.Label></Chip>
          </View>
          {exchange.description ? (
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{exchange.description}</Text>
          ) : null}
          <View className="flex-row flex-wrap gap-2">
            <Metric icon="people-outline" tone={tone} label={t('groupExchanges.participants', { count: participants.length })} />
            <Metric icon="time-outline" tone={tone} label={t('groupExchanges.hours', { count: Number(exchange.total_hours) })} />
            <Metric icon="git-compare-outline" tone={tone} label={t(`groupExchanges.split.${exchange.split_type}`)} />
          </View>
        </HeroCard.Body>
      </HeroCard>

      {(canConfirm || canComplete || canCancel) ? (
        <HeroCard className="mb-4 rounded-panel p-0">
          <HeroCard.Body className="gap-3 p-4">
            <Text className="text-base font-semibold" style={{ color: theme.text }}>{t('groupExchanges.detail.actions.title')}</Text>
            <View className="flex-row flex-wrap gap-2">
              {canConfirm ? (
                <HeroButton variant="primary" onPress={() => void runAction('confirm')} isDisabled={submitting}>
                  <HeroButton.Label>{t('groupExchanges.detail.actions.confirm')}</HeroButton.Label>
                </HeroButton>
              ) : null}
              {canComplete ? (
                <HeroButton variant="primary" onPress={() => void runAction('complete')} isDisabled={submitting}>
                  <HeroButton.Label>{t('groupExchanges.detail.actions.complete')}</HeroButton.Label>
                </HeroButton>
              ) : null}
              {canCancel ? (
                <HeroButton variant="secondary" onPress={confirmCancel} isDisabled={submitting}>
                  <HeroButton.Label>{t('groupExchanges.detail.actions.cancel')}</HeroButton.Label>
                </HeroButton>
              ) : null}
            </View>
          </HeroCard.Body>
        </HeroCard>
      ) : null}

      <HeroCard className="mb-4 rounded-panel p-0">
        <HeroCard.Body className="gap-3 p-4">
          <Text className="text-base font-semibold" style={{ color: theme.text }}>{t('groupExchanges.detail.participants')}</Text>
          {participants.length > 0 ? (
            participants.map((participant) => <ParticipantRow key={participant.id} participant={participant} tone={tone} />)
          ) : (
            <Surface variant="secondary" className="rounded-panel p-3">
              <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('groupExchanges.detail.noParticipants')}</Text>
            </Surface>
          )}
        </HeroCard.Body>
      </HeroCard>

      {Object.keys(exchange.calculated_split ?? {}).length > 0 ? (
        <HeroCard className="rounded-panel p-0">
          <HeroCard.Body className="gap-3 p-4">
            <Text className="text-base font-semibold" style={{ color: theme.text }}>{t('groupExchanges.detail.splitPreview')}</Text>
            {Object.entries(exchange.calculated_split).map(([fromId, rows]) => (
              <Surface key={fromId} variant="secondary" className="rounded-panel p-3">
                <Text className="text-sm font-medium" style={{ color: theme.text }}>{t('groupExchanges.detail.splitFrom', { id: fromId })}</Text>
                {Object.entries(rows).map(([toId, hours]) => (
                  <Text key={toId} className="text-sm" style={{ color: theme.textSecondary }}>
                    {t('groupExchanges.detail.splitTo', { id: toId, hours })}
                  </Text>
                ))}
              </Surface>
            ))}
          </HeroCard.Body>
        </HeroCard>
      ) : null}
      {confirmDialog}
    </ScreenShell>
  );
}

function ScreenShell({ children, title, backLabel, refreshing = false, onRefresh }: { children: React.ReactNode; title: string; backLabel: string; refreshing?: boolean; onRefresh?: () => void }) {
  const primary = usePrimaryColor();
  const theme = useTheme();
  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={title} backLabel={backLabel} fallbackHref={'/(modals)/group-exchanges' as Href} />
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={primary} colors={[primary]} /> : undefined}
        contentContainerStyle={{ padding: 16, paddingBottom: 40, flexGrow: 1 }}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ icon, tone, label }: { icon: React.ComponentProps<typeof Ionicons>['name']; tone: string; label: string }) {
  return (
    <Chip size="sm" variant="secondary">
      <Ionicons name={icon} size={12} color={tone} />
      <Chip.Label>{label}</Chip.Label>
    </Chip>
  );
}

function ParticipantRow({ participant, tone }: { participant: GroupExchangeParticipant; tone: string }) {
  const { t } = useTranslation('exchanges');
  const theme = useTheme();
  return (
    <Surface variant="secondary" className="rounded-panel p-3">
      <View className="flex-row items-center gap-3">
        <Avatar uri={participant.avatar_url} name={participant.name} size={40} />
        <View className="min-w-0 flex-1">
          <Text className="font-semibold" style={{ color: theme.text }} numberOfLines={1}>{participant.name || t('groupExchanges.unknownOrganizer')}</Text>
          <Text className="text-xs" style={{ color: theme.textSecondary }}>
            {t(`groupExchanges.detail.roles.${participant.role}`, { defaultValue: participant.role })}
          </Text>
        </View>
        <View className="items-end gap-1">
          <Chip size="sm" variant="secondary">
            <Ionicons name={participant.confirmed ? 'checkmark-circle-outline' : 'time-outline'} size={12} color={tone} />
            <Chip.Label>{participant.confirmed ? t('groupExchanges.detail.confirmed') : t('groupExchanges.detail.unconfirmed')}</Chip.Label>
          </Chip>
          <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('groupExchanges.hours', { count: Number(participant.hours) })}</Text>
        </View>
      </View>
    </Surface>
  );
}
