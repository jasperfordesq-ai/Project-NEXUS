// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import TypingIndicator from '@/components/TypingIndicator';
import { useTheme } from '@/lib/hooks/useTheme';

/**
 * "Alice is typing…" with the bouncing dots, shown between the message list and the
 * composer while the other member types. Announced politely to a screen reader so it is
 * heard once rather than interrupting.
 */
export default function TypingRow({ visible, name }: { visible: boolean; name: string }) {
  const { t } = useTranslation('messages');
  const theme = useTheme();
  if (!visible) return null;
  return (
    <View
      testID="thread-typing-row"
      accessibilityLiveRegion="polite"
      className="mb-1 flex-row items-center gap-2 pr-4"
    >
      <TypingIndicator visible />
      <Text className="text-xs" style={{ color: theme.textMuted }} numberOfLines={1}>
        {t('thread.typing', { name })}
      </Text>
    </View>
  );
}
