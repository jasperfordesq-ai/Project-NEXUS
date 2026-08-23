// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect } from 'react';
import { BackHandler, Platform, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Surface } from 'heroui-native';

import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface AppTopBarAction {
  accessibilityLabel: string;
  icon: IoniconName;
  onPress: () => void | Promise<void>;
}

interface AppTopBarProps {
  title: string;
  backLabel: string;
  fallbackHref?: Href;
  onBack?: () => void;
  rightAction?: AppTopBarAction;
}

export default function AppTopBar({
  title,
  backLabel,
  fallbackHref = '/(tabs)/home',
  onBack,
  rightAction,
}: AppTopBarProps) {
  const primary = usePrimaryColor();
  const theme = useTheme();

  const goBack = useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }

    if (typeof router.canGoBack === 'function' && router.canGoBack()) {
      router.back();
    } else {
      router.replace(fallbackHref);
    }
  }, [fallbackHref, onBack]);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      goBack();
      return true;
    });

    return () => subscription.remove();
  }, [goBack]);

  return (
    <Surface variant="default" className="mx-4 mt-2 mb-3 flex-row items-center gap-3 rounded-panel-inner px-3 py-2">
      <HeroButton variant="secondary" accessibilityLabel={backLabel} onPress={goBack}>
        <Ionicons name="arrow-back-outline" size={18} color={primary} />
        <HeroButton.Label>{backLabel}</HeroButton.Label>
      </HeroButton>

      <Text className="min-w-0 flex-1 text-base font-semibold" style={{ color: theme.text }} numberOfLines={1}>
        {title}
      </Text>

      <View className="min-w-[40px] items-end">
        {rightAction ? (
          <HeroButton isIconOnly variant="secondary" accessibilityLabel={rightAction.accessibilityLabel} onPress={() => void rightAction.onPress()}>
            <Ionicons name={rightAction.icon} size={18} color={primary} />
          </HeroButton>
        ) : null}
      </View>
    </Surface>
  );
}
