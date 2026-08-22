// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button as HeroButton, Card as HeroCard, Chip, Surface, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import SourceRepositoryLink from '@/components/SourceRepositoryLink';
import { getBlockedUsers, unblockUser, type BlockedUser } from '@/lib/api/settings';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';

function formatBlockedDate(value: string | null, locale: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function SettingsBlockedUsersScreen() {
  const { t, i18n } = useTranslation(['settings', 'common']);
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const [users, setUsers] = useState<BlockedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [unblockingId, setUnblockingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setUsers(await getBlockedUsers());
    } catch {
      showToast({ title: t('common:errors.generic'), description: t('blockedUsers.loadError'), variant: 'danger' });
    } finally {
      setIsLoading(false);
    }
  }, [t, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  function confirmUnblock(user: BlockedUser) {
    confirm({
      title: t('blockedUsers.unblockConfirmTitle', { name: user.name }),
      message: t('blockedUsers.unblockConfirmBody'),
      confirmLabel: t('blockedUsers.unblock'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: () => handleUnblock(user),
    });
  }

  async function handleUnblock(user: BlockedUser) {
    setUnblockingId(user.user_id);
    try {
      await unblockUser(user.user_id);
      setUsers((current) => current.filter((item) => item.user_id !== user.user_id));
      showToast({ title: t('blockedUsers.unblocked'), description: t('blockedUsers.unblockedDesc', { name: user.name }), variant: 'success' });
    } catch {
      showToast({ title: t('common:errors.generic'), description: t('blockedUsers.unblockError'), variant: 'danger' });
    } finally {
      setUnblockingId(null);
    }
  }

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('blockedUsers.title')} backLabel={t('common:buttons.back')} fallbackHref="/(modals)/settings" />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}>
          <HeroCard className="overflow-hidden rounded-panel p-0">
            <View className="h-1.5" style={{ backgroundColor: theme.error }} />
            <HeroCard.Body className="gap-3 p-4">
              <View className="flex-row items-start gap-3">
                <View className="size-11 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(theme.error, 0.12) }}>
                  <Ionicons name="shield-outline" size={22} color={theme.error} />
                </View>
                <View className="min-w-0 flex-1">
                  <Chip size="sm" variant="soft" color="danger">
                    <Chip.Label>{t('blockedUsers.privacyBadge')}</Chip.Label>
                  </Chip>
                  <Text className="mt-2 text-xl font-bold" style={{ color: theme.text }}>{t('blockedUsers.title')}</Text>
                  <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('blockedUsers.subtitle')}</Text>
                </View>
              </View>
              <Surface variant="secondary" className="rounded-panel-inner px-3 py-3">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textMuted }}>{t('blockedUsers.summaryLabel')}</Text>
                <Text className="text-base font-semibold" style={{ color: theme.text }}>{t('blockedUsers.count', { count: users.length })}</Text>
              </Surface>
            </HeroCard.Body>
          </HeroCard>

          {isLoading ? (
            <LoadingSpinner />
          ) : users.length === 0 ? (
            <EmptyState
              icon="shield-checkmark-outline"
              title={t('blockedUsers.empty')}
              subtitle={t('blockedUsers.emptyDesc')}
            />
          ) : (
            users.map((user) => (
              <HeroCard key={user.user_id} className="rounded-panel p-0">
                <HeroCard.Body className="gap-3 p-4">
                  <View className="flex-row items-center gap-3">
                    <Avatar uri={user.avatar_url} name={user.name} size={46} />
                    <View className="min-w-0 flex-1">
                      <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={1}>{user.name}</Text>
                      <Text className="text-xs" style={{ color: theme.textSecondary }}>
                        {t('blockedUsers.blockedOn', { date: formatBlockedDate(user.blocked_at, i18n.language) })}
                      </Text>
                    </View>
                  </View>
                  {user.reason ? (
                    <Surface variant="secondary" className="rounded-panel-inner px-3 py-2">
                      <Text className="text-xs" style={{ color: theme.textSecondary }}>{user.reason}</Text>
                    </Surface>
                  ) : null}
                  <HeroButton
                    variant="danger"
                    onPress={() => confirmUnblock(user)}
                    isDisabled={unblockingId !== null}
                  >
                    <HeroButton.Label>{unblockingId === user.user_id ? t('blockedUsers.unblocking') : t('blockedUsers.unblock')}</HeroButton.Label>
                  </HeroButton>
                </HeroCard.Body>
              </HeroCard>
            ))
          )}

          <SourceRepositoryLink />
        </ScrollView>
        {confirmDialog}
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}
