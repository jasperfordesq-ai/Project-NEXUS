// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * What a screen shows when a REFRESH fails and there is already something on screen.
 *
 * 🔴 This is the gap `ErrorState` deliberately does not cover, and it was silent. A screen
 * whose first load failed shows `ErrorState` and a Retry — that path works. A screen that
 * loaded fine and then failed to refresh showed nothing at all: `useApi` keeps the previous
 * `data`, so every `error ? <ErrorState/> : <list/>` branch stayed on the list, the pull
 * gesture snapped back, and the member was left looking at stale rows believing they were
 * current. On a wallet, a job pipeline or an event roster that is a genuinely misleading
 * screen, not a cosmetic one.
 *
 * A banner rather than a toast, for two reasons. It stays visible until the refresh
 * succeeds — a toast that has already faded cannot tell anyone the rows are old — and it
 * needs no provider, so a screen can adopt it without every one of its tests growing a
 * toast mock.
 *
 * It never replaces content. If the screen has nothing to show, `ErrorState` is the right
 * component and this one should not be rendered at all.
 */

import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Ionicons } from '@/components/ui/Icon';
import NativePressable from '@/components/ui/NativePressable';
import { useTheme } from '@/lib/hooks/useTheme';

interface RefreshFailedNoticeProps {
  /**
   * The failure in the member's language, or null when the last refresh succeeded. Null
   * renders nothing, so a call site can pass `state.error` straight through.
   */
  error: string | null;
  /** Try again. Omitted only where the screen has no way to re-run the request. */
  onRetry?: () => void;
  /** True while the retry is in flight, so a second tap does not queue another request. */
  isRetrying?: boolean;
  testID?: string;
}

export default function RefreshFailedNotice({
  error,
  onRetry,
  isRetrying = false,
  testID = 'refresh-failed-notice',
}: RefreshFailedNoticeProps) {
  const theme = useTheme();
  const { t } = useTranslation(['common']);

  if (!error) return null;

  return (
    <View
      accessibilityRole="alert"
      testID={testID}
      className="mb-3 flex-row items-start gap-3 rounded-panel px-4 py-3"
      style={{ backgroundColor: theme.errorBg, borderColor: theme.error, borderWidth: 1 }}
    >
      <Ionicons name="cloud-offline-outline" size={18} color={theme.error} style={{ marginTop: 2 }} />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-sm font-semibold" style={{ color: theme.text }}>
          {t('common:errors.refreshFailedTitle')}
        </Text>
        <Text className="text-xs leading-4" style={{ color: theme.textSecondary }}>
          {t('common:errors.refreshFailedSubtitle')}
        </Text>
      </View>
      {onRetry ? (
        <NativePressable
          accessibilityLabel={t('common:buttons.retry')}
          onPress={() => { if (!isRetrying) onRetry(); }}
          feedback="highlight"
        >
          <Text className="text-sm font-semibold" style={{ color: theme.error }}>
            {t('common:buttons.retry')}
          </Text>
        </NativePressable>
      ) : null}
    </View>
  );
}
