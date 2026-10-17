// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button as HeroButton } from '@/components/ui/NativeButton';
import { useTheme } from '@/lib/hooks/useTheme';
import { REACTION_EMOJIS } from '@/lib/messages/reactions';

/**
 * All six reactions in one row, at the top of the message sheet. 44×44 targets, the ones
 * this member already put on the message drawn filled and announced as selected.
 */
export default function ReactionRow({
  mine,
  onReact,
}: {
  /** Emoji this member has already reacted with on the message. */
  mine: readonly string[];
  onReact: (emoji: string) => void;
}) {
  const { t } = useTranslation('messages');
  const theme = useTheme();
  return (
    <View className="gap-2 px-1 pb-2 pt-1">
      <Text className="text-xs font-semibold uppercase" style={{ color: theme.textMuted }}>
        {t('thread.reactions.title')}
      </Text>
      <View className="flex-row flex-wrap items-center gap-1">
        {REACTION_EMOJIS.map((emoji) => {
          const selected = mine.includes(emoji);
          return (
            <HeroButton
              key={emoji}
              isIconOnly
              size="md"
              variant={selected ? 'secondary' : 'ghost'}
              className="h-11 w-11 rounded-full"
              style={{ width: 44, height: 44, minWidth: 44, minHeight: 44 }}
              accessibilityRole="button"
              accessibilityLabel={t('thread.reactWith', { emoji })}
              accessibilityState={{ selected }}
              onPress={() => onReact(emoji)}
            >
              <Text className="text-xl">{emoji}</Text>
            </HeroButton>
          );
        })}
      </View>
    </View>
  );
}
