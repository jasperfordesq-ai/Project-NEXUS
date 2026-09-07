// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Shown on a listing form when the listing itself saved but something attached to it
 * did not — its skills, or its photo.
 *
 * 🔴 Audit 2026-09-06, F06. This replaces a toast and an immediate `router.replace`. The
 * toast said what failed and the navigation then threw away the very data that failed,
 * so a member who wanted their skills or their photo had no way to try again except to
 * fill the form in from scratch — which on the create screen posts a SECOND listing. The
 * notice stays on screen, keeps the failed input in the form behind it, and retries only
 * the part that failed against the listing that already exists.
 *
 * The wording is passed in rather than looked up here: the create and edit screens sit in
 * the same namespace but say different things, and this component has no business
 * deciding which.
 */

import React from 'react';
import { View } from 'react-native';
import { Button as HeroButton, Card as HeroCard, Text } from 'heroui-native';

import { Ionicons } from '@/components/ui/Icon';
import { useTheme } from '@/lib/hooks/useTheme';

interface ListingPartialSaveNoticeProps {
  tagsFailed: boolean;
  imageFailed: boolean;
  isRetrying: boolean;
  onRetry: () => void;
  onContinue: () => void;
  title: string;
  tags: string;
  image: string;
  retry: string;
  continueLabel: string;
}

export default function ListingPartialSaveNotice({
  tagsFailed,
  imageFailed,
  isRetrying,
  onRetry,
  onContinue,
  title,
  tags,
  image,
  retry,
  continueLabel,
}: ListingPartialSaveNoticeProps) {
  const theme = useTheme();

  return (
    <HeroCard
      className="rounded-panel border p-0"
      style={{ borderColor: theme.warning }}
      testID="listing-partial-save"
    >
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-start gap-3">
          <Ionicons name="alert-circle-outline" size={20} color={theme.warning} />
          <Text className="flex-1 text-sm font-semibold" style={{ color: theme.text }}>{title}</Text>
        </View>

        <View className="gap-1 pl-8">
          {tagsFailed ? (
            <Text className="text-sm" style={{ color: theme.textSecondary }}>{tags}</Text>
          ) : null}
          {imageFailed ? (
            <Text className="text-sm" style={{ color: theme.textSecondary }}>{image}</Text>
          ) : null}
        </View>

        <View className="flex-row gap-2">
          <HeroButton
            className="flex-1"
            variant="primary"
            isDisabled={isRetrying}
            onPress={onRetry}
            testID="listing-partial-save-retry"
          >
            <HeroButton.Label>{retry}</HeroButton.Label>
          </HeroButton>
          <HeroButton
            className="flex-1"
            variant="secondary"
            onPress={onContinue}
            testID="listing-partial-save-continue"
          >
            <HeroButton.Label>{continueLabel}</HeroButton.Label>
          </HeroButton>
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}
