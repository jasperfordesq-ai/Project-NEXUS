// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React, { useCallback } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@/components/ui/Icon';
import * as Haptics from '@/lib/haptics';
import { Button as HeroButton } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { contrastText } from '@/lib/utils/color';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface FABProps {
  icon?: IoniconName;
  onPress: () => void;
  color?: string;
  position?: 'bottom-right' | 'bottom-center';
  accessibilityLabel?: string;
}

export default function FAB({ icon = 'add', onPress, color, position = 'bottom-right', accessibilityLabel }: FABProps) {
  const { t } = useTranslation('common');
  const primary = usePrimaryColor();
  const bgColor = color ?? primary;

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onPress();
  }, [onPress]);

  const wrapperClass = position === 'bottom-center'
    ? 'absolute z-10 bottom-4 left-0 right-0 items-center'
    : 'absolute z-10 bottom-4 right-4';

  return (
    <View className={wrapperClass} pointerEvents="box-none">
      <HeroButton
        isIconOnly
        variant="primary"
        size="lg"
        onPress={handlePress}
        accessibilityLabel={accessibilityLabel ?? t('aria.actionButton')}
        className="h-14 w-14 rounded-full"
        style={{ backgroundColor: bgColor, elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.27, shadowRadius: 4.65 }}
      >
        <Ionicons name={icon} size={28} color={contrastText(bgColor)} />
      </HeroButton>
    </View>
  );
}
