// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button as HeroButton, Spinner, Surface, Text } from 'heroui-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getRootBottomInset } from '@/lib/ui/rootInsets';
import { useTheme } from '@/lib/hooks/useTheme';
import AccentIcon from '@/components/ui/AccentIcon';

export default function FormActionFooter({
  title,
  subtitle,
  submitLabel,
  secondaryLabel,
  icon = 'checkmark-outline',
  primary,
  isSubmitting,
  isDisabled,
  onSubmit,
  onSecondary,
}: {
  title: string;
  subtitle: string;
  submitLabel: string;
  secondaryLabel?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  primary: string;
  isSubmitting: boolean;
  isDisabled?: boolean;
  onSubmit: () => void;
  onSecondary?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  // Android modal screens report bottom inset 0 — use the root-recorded
  // inset as a floor so the footer clears the system navigation bar.
  const bottomInset = Math.max(insets.bottom, getRootBottomInset());

  return (
    <Surface
      variant="default"
      className="border-t border-border/50 px-4 pt-3"
      style={{ paddingBottom: Math.max(12, bottomInset) }}
    >
      <View className="flex-row items-center gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-bold" style={{ color: theme.text }} numberOfLines={1}>
            {title}
          </Text>
          <Text className="text-xs leading-4" style={{ color: theme.textSecondary }} numberOfLines={2}>
            {subtitle}
          </Text>
        </View>
        <View className="flex-row gap-2">
          {secondaryLabel && onSecondary ? (
            <HeroButton variant="secondary" onPress={onSecondary} isDisabled={isSubmitting}>
              <HeroButton.Label>{secondaryLabel}</HeroButton.Label>
            </HeroButton>
          ) : null}
          <HeroButton
            variant="primary"
            onPress={onSubmit}
            isDisabled={isSubmitting || isDisabled}
            style={{ backgroundColor: isSubmitting || isDisabled ? theme.border : primary }}
          >
            {isSubmitting ? <Spinner size="sm" /> : <AccentIcon name={icon} size={16} />}
            <HeroButton.Label>{submitLabel}</HeroButton.Label>
          </HeroButton>
        </View>
      </View>
    </Surface>
  );
}
