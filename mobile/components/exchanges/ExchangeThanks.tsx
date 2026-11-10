// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The thank-you a member sees when their confirmation completes an exchange
 * (AWID feedback, Nov 2026: "energy, warmth, and community") — the app's copy of
 * the website's `ExchangeThanks`: a soft panel in the community's colour and
 * the member's year so far (how many people they have exchanged with, and how
 * many hours), from the server's `thanks` on POST /v2/exchanges/{id}/confirm.
 * Only the member's own figures.
 *
 * It is announced when it appears (a polite live region). The website adds a
 * burst of confetti; the app does not, rather than add an animation library for
 * it, and a success haptic already marks the moment.
 */

import { Text, View } from 'react-native';
import { Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import { Button as HeroButton } from '@/components/ui/NativeButton';
import { Ionicons } from '@/components/ui/Icon';
import { useTheme } from '@/lib/hooks/useTheme';
import { bandColours } from '@/lib/theme/itemColours';
import { useColourScheme, useItemPalette } from '@/lib/theme/useItemColours';
import { formatDecimal } from '@/lib/utils/decimal';

interface Props {
  neighbours: number;
  hours: number;
  onClose: () => void;
  /** The other person's first name, for "Send … a thank-you message". */
  partnerName?: string | null;
  /** Opens a message to them; no button when messaging is unavailable. */
  onSendMessage?: (() => void) | null;
}

export default function ExchangeThanks({ neighbours, hours, onClose, partnerName, onSendMessage }: Props) {
  const { t } = useTranslation('exchanges');
  const theme = useTheme();
  const scheme = useColourScheme();
  // The community's own colour family (the first colour of its palette).
  const band = bandColours(useItemPalette()[0], scheme);
  const figureBackground = scheme === 'light' ? 'rgba(255, 255, 255, 0.7)' : 'rgba(255, 255, 255, 0.1)';

  return (
    <Surface
      variant="default"
      className="mt-4 gap-4 rounded-2xl p-4"
      style={{ backgroundColor: band.background }}
      accessibilityLiveRegion="polite"
      testID="exchange-thanks"
    >
      <View className="flex-row items-start gap-3">
        <View
          className="size-12 items-center justify-center rounded-2xl"
          style={{ backgroundColor: figureBackground }}
        >
          <Ionicons name="heart-outline" size={24} color={band.text} />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Text accessibilityRole="header" className="text-xl font-bold" style={{ color: band.text }}>
            {t('thanks.title')}
          </Text>
          <Text className="text-sm leading-5" style={{ color: band.text }}>{t('thanks.body')}</Text>
        </View>
        <HeroButton
          isIconOnly
          size="sm"
          variant="ghost"
          onPress={onClose}
          accessibilityLabel={t('thanks.close')}
          testID="exchange-thanks-close"
        >
          <Ionicons name="close" size={18} color={band.text} />
        </HeroButton>
      </View>

      <View className="flex-row gap-2">
        <View className="flex-1 items-center rounded-xl px-3 py-2" style={{ backgroundColor: figureBackground }} accessible accessibilityLabel={`${formatDecimal(neighbours, 2)} ${t('thanks.neighboursLabel')}`}>
          <Text className="text-2xl font-bold" style={{ color: theme.text }}>{formatDecimal(neighbours, 2)}</Text>
          <Text className="text-center text-xs" style={{ color: theme.textSecondary }}>{t('thanks.neighboursLabel')}</Text>
        </View>
        <View className="flex-1 items-center rounded-xl px-3 py-2" style={{ backgroundColor: figureBackground }} accessible accessibilityLabel={`${formatDecimal(hours, 2)} ${t('thanks.hoursLabel')}`}>
          <Text className="text-2xl font-bold" style={{ color: theme.text }}>{formatDecimal(hours, 2)}</Text>
          <Text className="text-center text-xs" style={{ color: theme.textSecondary }}>{t('thanks.hoursLabel')}</Text>
        </View>
      </View>

      {partnerName && onSendMessage ? (
        <HeroButton variant="primary" onPress={onSendMessage} testID="exchange-thanks-message">
          <HeroButton.Label>{t('thanks.sendMessage', { name: partnerName })}</HeroButton.Label>
        </HeroButton>
      ) : null}
    </Surface>
  );
}
