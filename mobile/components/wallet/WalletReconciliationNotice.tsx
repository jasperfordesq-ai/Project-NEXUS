// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Surface, Text } from 'heroui-native';

import { Button as HeroButton } from '@/components/ui/NativeButton';
import { Ionicons } from '@/components/ui/Icon';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';

export default function WalletReconciliationNotice({ onReview }: { onReview: () => void }) {
  const { t } = useTranslation('wallet');
  const primary = usePrimaryColor();
  const theme = useTheme();

  return (
    <Surface
      variant="secondary"
      className="gap-3 rounded-panel-inner p-4"
      style={{ borderWidth: 1, borderColor: withAlpha(theme.warning, 0.45) }}
      testID="wallet-unresolved-operation"
      accessibilityRole="alert"
    >
      <View className="flex-row items-start gap-3">
        <Ionicons name="alert-circle-outline" size={20} color={theme.warning} />
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-base font-bold" style={{ color: theme.text }}>{t('actions.unresolvedTitle')}</Text>
          <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('actions.unresolvedOperation')}</Text>
        </View>
      </View>
      <View className="gap-2">
        <HeroButton variant="secondary" onPress={onReview}>
          <Ionicons name="receipt-outline" size={16} color={primary} />
          <HeroButton.Label>{t('actions.reviewHistory')}</HeroButton.Label>
        </HeroButton>
        <HeroButton
          variant="secondary"
          onPress={() => router.push({ pathname: '/(modals)/static-page', params: { key: 'contact' } })}
        >
          <Ionicons name="mail-outline" size={16} color={primary} />
          <HeroButton.Label>{t('actions.contactCommunity')}</HeroButton.Label>
        </HeroButton>
      </View>
    </Surface>
  );
}
