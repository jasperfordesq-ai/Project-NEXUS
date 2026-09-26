// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { View } from 'react-native';
import { router } from 'expo-router';
import { Card as HeroCard, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import { Button as HeroButton } from '@/components/ui/NativeButton';
import { Ionicons } from '@/components/ui/Icon';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import type { GroupSubgroup } from '@/lib/api/groups';

function validSubgroup(value: unknown, parentId: number): value is GroupSubgroup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Number.isInteger(item.id)
    && (item.id as number) > 0
    && item.id !== parentId
    && item.parent_id === parentId
    && typeof item.name === 'string'
    && item.name.trim().length > 0
    && (item.description === null || typeof item.description === 'string')
    && (item.image_url === null || typeof item.image_url === 'string')
    && (item.visibility === 'public' || item.visibility === 'private')
    && Number.isInteger(item.member_count)
    && (item.member_count as number) >= 0
    && (item.type_id === null || Number.isInteger(item.type_id));
}

export function hasValidSubgroups(value: unknown, parentId: number): value is GroupSubgroup[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => validSubgroup(item, parentId));
}

export default function GroupSubgroupsPanel({ groupId, subgroups }: { groupId: number; subgroups: unknown }) {
  const { t } = useTranslation('groups');
  const primary = usePrimaryColor();
  const theme = useTheme();
  const rows = hasValidSubgroups(subgroups, groupId) ? subgroups : [];

  if (rows.length === 0) return null;

  return (
    <View className="gap-3" testID="group-subgroups-panel">
      <View className="gap-1">
        <Text className="text-lg font-bold" style={{ color: theme.text }}>{t('detail.subgroups.title')}</Text>
        <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('detail.subgroups.subtitle')}</Text>
      </View>
      {rows.map((subgroup) => (
        <HeroCard key={subgroup.id} className="rounded-panel p-0">
          <HeroCard.Body className="gap-2 p-4">
            <View className="flex-row items-start gap-3">
              <View className="min-w-0 flex-1 gap-1">
                <Text className="text-base font-bold" style={{ color: theme.text }}>{subgroup.name}</Text>
                {subgroup.description ? (
                  <Text className="text-sm" numberOfLines={2} style={{ color: theme.textSecondary }}>{subgroup.description}</Text>
                ) : null}
                <Text className="text-xs" style={{ color: theme.textMuted }}>
                  {t('members', { count: subgroup.member_count })}
                </Text>
              </View>
              <HeroButton
                isIconOnly
                variant="secondary"
                accessibilityLabel={t('detail.subgroups.open', { name: subgroup.name })}
                onPress={() => router.push({ pathname: '/(modals)/group-detail', params: { id: String(subgroup.id) } })}
              >
                <Ionicons name="chevron-forward" size={19} color={primary} />
              </HeroButton>
            </View>
          </HeroCard.Body>
        </HeroCard>
      ))}
    </View>
  );
}
