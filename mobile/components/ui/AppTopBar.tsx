// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback } from 'react';
import { BackHandler, Platform, Text, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Surface } from 'heroui-native';
import { Button as HeroButton } from '@/components/ui/NativeButton';

import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { CHROME_MAX_FONT_SCALE } from '@/lib/ui/textScale';

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
  const { fontScale } = useWindowDimensions();

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

  /*
    Android's hardware/gesture Back.

    🔴 `useFocusEffect`, not `useEffect` (audit 2026-09-06, F10). `BackHandler` is a
    GLOBAL stack and this listener returns `true`, which consumes the press outright. It
    used to be registered for as long as the bar was MOUNTED — and a tab screen stays
    mounted when you switch tabs, as does a stack screen that another screen has been
    pushed on top of. So a bar belonging to a screen the member could not see could swallow
    Back and run its own fallback instead of the focused screen's, sending them somewhere
    they had not asked to go. Registering only while focused means at most one bar is ever
    listening, and it is the one the member is looking at.
  */
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return undefined;

      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        goBack();
        return true;
      });

      return () => subscription.remove();
    }, [goBack]),
  );

  return (
    <Surface variant="default" className="mx-4 mt-2 mb-3 flex-row items-center gap-3 rounded-panel-inner px-3 py-2">
      <HeroButton variant="secondary" accessibilityLabel={backLabel} onPress={goBack}>
        <Ionicons name="arrow-back-outline" size={18} color={primary} />
        <HeroButton.Label key={fontScale} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>{backLabel}</HeroButton.Label>
      </HeroButton>

      {/*
        🔴 Capped, and this one bar decides it for 134 screens. The title shares its row with
        the Back button and an optional action, so at the OS's largest text setting it either
        squeezed them out or was itself squeezed to nothing. `numberOfLines={1}` then hid the
        damage by truncating — the row looked fine and the screen had lost its name.
        Ordinary body text inside screens is deliberately left uncapped; see lib/ui/textScale.ts.
      */}
      <Text
        key={fontScale}
        accessibilityRole="header"
        className="min-w-0 flex-1 text-base font-semibold"
        style={{ color: theme.text }}
        numberOfLines={1}
        maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
      >
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
