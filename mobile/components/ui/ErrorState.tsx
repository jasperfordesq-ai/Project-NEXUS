// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * What a screen shows when its data failed to load, with a way to try again.
 *
 * 🔴 Why this did not exist until now, which is the interesting part. `components/ui/` had
 * `EmptyState`, `LoadingSpinner` and `Skeleton` — the happy path and the waiting path — but
 * nothing for failure. So every screen improvised, and a readiness audit found retry offered
 * on only 19 of 43 large screens; `app/(tabs)/profile.tsx` had no failure branch at all
 * (zero references to `error`), meaning a failed load left a member looking at a permanent
 * skeleton with no way to recover but to kill the app.
 *
 * Crashes were never the gap — `ModalErrorBoundary` covers ~100% of modals. The gap is the
 * ordinary case: the request came back 500, or the train went into a tunnel.
 *
 * Deliberately mirrors `EmptyState`'s shape (icon/title/subtitle/action) so adopting it is a
 * substitution rather than a redesign, and so the two read as one family on screen. The
 * differences are only those that matter for failure: the icon defaults to a warning, it
 * carries the error tone rather than the muted one, and `onRetry` is a first-class prop
 * because a dead end without one is the actual defect.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@/components/ui/Icon';
import { useTranslation } from 'react-i18next';

import Button from './Button';
import { useTheme } from '@/lib/hooks/useTheme';

interface ErrorStateProps {
  /** What went wrong, in the member's language. Falls back to a generic apology. */
  title?: string;
  /** Optional detail — an API message, or advice such as "check your connection". */
  subtitle?: string;
  /**
   * Try again. Optional only because a few failures genuinely cannot be retried (a deleted
   * record); when it is omitted the component still explains itself rather than showing a
   * button that does nothing.
   */
  onRetry?: () => void;
  /** Override the retry wording (default: the shared "Try again"). */
  retryLabel?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** Set while a retry is in flight, so the member sees the tap register. */
  isRetrying?: boolean;
  testID?: string;
}

export default function ErrorState({
  title,
  subtitle,
  onRetry,
  retryLabel,
  icon = 'alert-circle-outline',
  isRetrying = false,
  testID,
}: ErrorStateProps) {
  const theme = useTheme();
  const { t } = useTranslation(['common']);

  return (
    <View className="items-center justify-center px-8 py-12" testID={testID}>
      <Ionicons name={icon} size={48} color={theme.error} style={{ marginBottom: 16 }} />
      <Text className="mb-2 text-center text-lg font-semibold text-foreground">
        {title ?? t('common:errors.loadFailedTitle')}
      </Text>
      <Text className="mb-1 text-center text-sm leading-5 text-muted-foreground">
        {subtitle ?? t('common:errors.loadFailedSubtitle')}
      </Text>
      {onRetry ? (
        <View className="mt-5">
          <Button onPress={onRetry} disabled={isRetrying}>
            {retryLabel ?? t('common:buttons.retry')}
          </Button>
        </View>
      ) : null}
    </View>
  );
}
