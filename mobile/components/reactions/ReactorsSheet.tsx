// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ReactorsSheet — bottom sheet listing who reacted, with an emoji filter row
 * (web ReactionSummary modal parity). Lazy-loads each reaction type's users
 * from /v2/reactions/{type}/{id}/users/{reactionType}.
 */

import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { Ionicons } from '@/components/ui/Icon';
import { Spinner } from 'heroui-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';

import { getReactors, type ReactionsSummary, type ReactionType, type ReactorUser } from '@/lib/api/feed';
import Avatar from '@/components/ui/Avatar';
import BottomSheet from '@/components/ui/BottomSheet';
import NativePressable from '@/components/ui/NativePressable';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { REACTION_EMOJI_MAP } from './ReactionBar';

export default function ReactorsSheet({
  visible,
  targetType,
  targetId,
  reactions,
  onClose,
}: {
  visible: boolean;
  targetType: string;
  targetId: number;
  reactions: ReactionsSummary | null;
  onClose: () => void;
}) {
  const { t } = useTranslation(['home', 'common']);
  const theme = useTheme();
  const primary = usePrimaryColor();

  const typesPresent = Object.entries(reactions?.counts ?? {})
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([type]) => type as ReactionType);

  const [activeType, setActiveType] = useState<ReactionType | null>(null);
  const [users, setUsers] = useState<ReactorUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // Default to the most common reaction whenever the sheet opens
  useEffect(() => {
    if (visible) {
      setActiveType(typesPresent[0] ?? null);
    } else {
      setUsers([]);
      setFailed(false);
    }
    // typesPresent is derived from reactions — keying on visible/targetId is enough
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, targetId]);

  const loadUsers = useCallback(async (type: ReactionType) => {
    setIsLoading(true);
    setFailed(false);
    try {
      const response = await getReactors(targetType, targetId, type);
      setUsers(response.data ?? []);
    } catch {
      setUsers([]);
      setFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [targetId, targetType]);

  useEffect(() => {
    if (visible && activeType) {
      void loadUsers(activeType);
    }
  }, [activeType, loadUsers, visible]);

  function openProfile(userId: number) {
    onClose();
    router.push({ pathname: '/(modals)/member-profile', params: { id: String(userId) } });
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} snapPoints={['60%', '90%']} title={t('reaction.reactorsTitle')}>
      <View className="flex-1">
        <View className="flex-row flex-wrap gap-2 py-2">
          {typesPresent.map((type) => {
            const isActive = activeType === type;
            return (
              <NativePressable
                key={type}
                onPress={() => setActiveType(type)}
                accessibilityLabel={t(`reaction.${type}`)}
                className="min-h-11 flex-row items-center gap-1 rounded-full px-3 py-1.5"
                style={{
                  backgroundColor: isActive ? withAlpha(primary, 0.16) : theme.surface,
                  borderWidth: 1,
                  borderColor: isActive ? withAlpha(primary, 0.4) : theme.borderSubtle,
                }}
              >
                {type === 'time_credit' ? (
                  <Ionicons name="time-outline" size={15} color={primary} />
                ) : (
                  <Text style={{ fontSize: 14 }}>{REACTION_EMOJI_MAP[type]}</Text>
                )}
                <Text className="text-xs font-semibold" style={{ color: isActive ? primary : theme.textSecondary }}>
                  {reactions?.counts?.[type] ?? 0}
                </Text>
              </NativePressable>
            );
          })}
        </View>

        {isLoading ? (
          <View className="items-center py-8">
            <Spinner size="sm" />
          </View>
        ) : failed ? (
          <Text className="py-8 text-center text-sm" style={{ color: theme.textSecondary }}>
            {t('common:errors.generic')}
          </Text>
        ) : (
          <BottomSheetFlatList
            data={users}
            keyExtractor={(user: ReactorUser) => String(user.id)}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 24 }}
            ListEmptyComponent={
              <Text className="py-8 text-center text-sm" style={{ color: theme.textSecondary }}>
                {t('reaction.noReactors')}
              </Text>
            }
            renderItem={({ item: user }: { item: ReactorUser }) => (
              <NativePressable
                onPress={() => openProfile(user.id)}
                accessibilityLabel={user.name}
                feedback="highlight"
                className="w-full"
              >
                <View className="flex-row items-center gap-3 py-2.5">
                  <Avatar uri={user.avatar_url} name={user.name} size={38} />
                  <Text className="min-w-0 flex-1 text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                    {user.name}
                  </Text>
                  <Ionicons name="chevron-forward-outline" size={15} color={theme.textMuted} />
                </View>
              </NativePressable>
            )}
          />
        )}
      </View>
    </BottomSheet>
  );
}
