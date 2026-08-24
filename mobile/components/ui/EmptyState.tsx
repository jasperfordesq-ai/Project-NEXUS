// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@/components/ui/Icon';
import Button from './Button';
import { useTheme } from '@/lib/hooks/useTheme';

interface EmptyStateProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Lets a test assert WHICH empty state is on screen, not just that one is. */
  testID?: string;
}

export default function EmptyState({ icon, title, subtitle, actionLabel, onAction, testID }: EmptyStateProps) {
  const theme = useTheme();

  return (
    <View className="items-center justify-center px-8 py-12" testID={testID}>
      <Ionicons name={icon} size={48} color={theme.textMuted} style={{ marginBottom: 16 }} />
      <Text className="text-lg font-semibold text-foreground text-center mb-2">{title}</Text>
      {subtitle ? (
        <Text className="text-sm text-muted-foreground text-center leading-5 mb-1">{subtitle}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <View className="mt-5">
          <Button onPress={onAction}>{actionLabel}</Button>
        </View>
      ) : null}
    </View>
  );
}
