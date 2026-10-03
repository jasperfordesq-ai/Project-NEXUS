// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Card as HeroCard, Text } from 'heroui-native';

import { Button as HeroButton } from '@/components/ui/NativeButton';
import AccentIcon from '@/components/ui/AccentIcon';
import { Ionicons } from '@/components/ui/Icon';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';

/** The native Help & support form. One constant, so every way in agrees. */
export const HELP_SUPPORT_ROUTE = '/(modals)/help-support' as Href;

/**
 * The way into the Help & support form from the screens a member reaches when
 * they are looking for help.
 *
 *  - `featured` heads the Support screen: the first thing on it, because sending
 *    a request is the one thing on that screen that gets a person involved.
 *  - `followUp` closes the help answers and guides — "Still need help?" — for
 *    the member who read them and is still stuck.
 *
 * Opens the native form; never a browser.
 */
export default function HelpSupportPrompt({
  variant,
  testID,
}: {
  variant: 'featured' | 'followUp';
  testID?: string;
}) {
  const { t } = useTranslation('profile');
  const theme = useTheme();
  const tone = theme.info;
  const keys = variant === 'featured' ? 'support.requestCard' : 'support.stillNeedHelp';
  const title = t(`${keys}.title`);
  const action = t(`${keys}.action`);

  return (
    <HeroCard
      testID={testID}
      className="overflow-hidden rounded-panel p-0"
      style={{ borderWidth: variant === 'featured' ? 2 : 1, borderColor: withAlpha(tone, variant === 'featured' ? 0.4 : 0.2) }}
    >
      <HeroCard.Body className="gap-4 p-4" style={{ backgroundColor: withAlpha(tone, variant === 'featured' ? 0.06 : 0.03) }}>
        <View className="flex-row items-start gap-3">
          <View className="size-12 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(tone, 0.14) }}>
            <Ionicons name={variant === 'featured' ? 'help-buoy-outline' : 'chatbubbles-outline'} size={24} color={tone} />
          </View>
          <View className="min-w-0 flex-1">
            <Text
              accessibilityRole="header"
              className={variant === 'featured' ? 'text-lg font-bold' : 'text-base font-bold'}
              style={{ color: theme.text }}
            >
              {title}
            </Text>
            <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }}>
              {t(`${keys}.description`)}
            </Text>
          </View>
        </View>
        <HeroButton
          testID={testID ? `${testID}-open` : undefined}
          accessibilityLabel={action}
          variant={variant === 'featured' ? 'primary' : 'secondary'}
          onPress={() => router.push(HELP_SUPPORT_ROUTE)}
          className="min-h-11 rounded-full"
        >
          {variant === 'featured'
            ? <AccentIcon name="chatbubble-ellipses-outline" size={17} />
            : <Ionicons name="chatbubble-ellipses-outline" size={17} color={tone} />}
          <HeroButton.Label className="text-sm font-semibold">{action}</HeroButton.Label>
        </HeroButton>
      </HeroCard.Body>
    </HeroCard>
  );
}
