// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState } from 'react';
import { FlatList, Image, Linking, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card as HeroCard } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import NativePressable from '@/components/ui/NativePressable';
import SearchInput from '@/components/ui/SearchInput';
import { getClubs, type Club } from '@/lib/api/clubs';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';

export default function ClubsScreen() {
  const { t } = useTranslation(['clubs', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const clubs = useApi(() => getClubs({ search: query || undefined }), [query]);

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={t('title')} backLabel={t('common:back')} fallbackHref="/(tabs)/profile" />
        <FlatList
          data={clubs.data?.items ?? []}
          keyExtractor={(club) => String(club.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 40, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={clubs.refresh} tintColor={primary} colors={[primary]} />}
          ListHeaderComponent={(
            <View className="mb-4 gap-4">
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('subtitle')}</Text>
              <SearchInput
                value={search}
                onChangeText={(value) => { setSearch(value); if (!value) setQuery(''); }}
                onSubmitEditing={() => setQuery(search.trim())}
                placeholder={t('search_placeholder')}
                accessibilityLabel={t('search_placeholder')}
                clearLabel={t('common:actions.clear')}
                returnKeyType="search"
              />
            </View>
          )}
          renderItem={({ item }) => <ClubCard club={item} />}
          ListEmptyComponent={clubs.isLoading ? <LoadingSpinner /> : (
            <EmptyState
              icon={clubs.error ? 'warning-outline' : 'people-outline'}
              title={clubs.error ?? t('empty.title')}
              subtitle={clubs.error ? undefined : t('empty.body')}
              actionLabel={clubs.error ? t('common:buttons.retry') : undefined}
              onAction={clubs.error ? clubs.refresh : undefined}
            />
          )}
        />
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

function ClubCard({ club }: { club: Club }) {
  const { t } = useTranslation('clubs');
  const theme = useTheme();
  const content = (
    <HeroCard className="mb-3 rounded-panel">
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-start gap-3">
          {club.logo_url ? <Image source={{ uri: club.logo_url }} className="h-14 w-14 rounded-panel-inner" accessibilityLabel="" /> : <View className="h-14 w-14 rounded-panel-inner bg-default-100" />}
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-lg font-bold" style={{ color: theme.text }}>{club.name}</Text>
            <Text className="text-xs" style={{ color: theme.textMuted }}>{t('member_count', { count: club.member_count })}</Text>
          </View>
        </View>
        {club.description ? <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={4}>{club.description}</Text> : null}
        {club.meeting_schedule ? <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('meeting_schedule', { schedule: club.meeting_schedule })}</Text> : null}
        {club.website ? <Text className="text-sm font-semibold text-primary">{t('view')}</Text> : null}
      </HeroCard.Body>
    </HeroCard>
  );
  return club.website ? (
    <NativePressable accessibilityLabel={`${t('view')}: ${club.name}`} onPress={() => void Linking.openURL(club.website!)} feedback="highlight">{content}</NativePressable>
  ) : content;
}
