// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Skeleton } from 'heroui-native';


// ---------------------------------------------------------------------------
// SkeletonBox — base primitive
// ---------------------------------------------------------------------------

interface SkeletonBoxProps {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

export function SkeletonBox({
  width = '100%',
  height = 14,
  borderRadius = 6,
  style,
}: SkeletonBoxProps): React.JSX.Element {
  return (
    <Skeleton
      variant="shimmer"
      style={[{ width: width as ViewStyle['width'], height, borderRadius }, style]}
    />
  );
}

// ---------------------------------------------------------------------------
// FeedItemSkeleton
// ---------------------------------------------------------------------------

export function FeedItemSkeleton(): React.JSX.Element {
  return (
    <View
      className="bg-surface rounded-2xl mx-4 my-1.5 p-4 gap-2"
      style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 }}
    >
      <View className="flex-row items-center gap-2.5">
        <Skeleton variant="shimmer" style={{ width: 36, height: 36, borderRadius: 18 }} />
        <View className="flex-1 gap-1.5">
          <Skeleton variant="shimmer" style={{ width: 120, height: 12, borderRadius: 6 }} />
          <Skeleton variant="shimmer" style={{ width: 72, height: 10, borderRadius: 6 }} />
        </View>
      </View>
      <Skeleton variant="shimmer" style={{ width: '100%', height: 16, borderRadius: 6 }} />
      <Skeleton variant="shimmer" style={{ width: '100%', height: 14, borderRadius: 6 }} />
      <Skeleton variant="shimmer" style={{ width: '100%', height: 14, borderRadius: 6 }} />
      <Skeleton variant="shimmer" style={{ width: '60%', height: 10, borderRadius: 6 }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// ConversationSkeleton
// ---------------------------------------------------------------------------

export function ConversationSkeleton(): React.JSX.Element {
  return (
    <View className="flex-row items-center bg-surface px-4 py-3 gap-3">
      <Skeleton variant="shimmer" style={{ width: 48, height: 48, borderRadius: 24 }} />
      <View className="flex-1 gap-2">
        <Skeleton variant="shimmer" style={{ width: 120, height: 13, borderRadius: 6 }} />
        <Skeleton variant="shimmer" style={{ width: '60%', height: 11, borderRadius: 6 }} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// EventCardSkeleton
// ---------------------------------------------------------------------------

export function EventCardSkeleton(): React.JSX.Element {
  return (
    <View
      className="flex-row items-start bg-surface gap-3 p-4 rounded-2xl"
      style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 }}
    >
      <Skeleton variant="shimmer" style={{ width: 48, height: 52, borderRadius: 8 }} />
      <View className="flex-1 gap-2">
        <Skeleton variant="shimmer" style={{ width: '80%', height: 16, borderRadius: 6 }} />
        <Skeleton variant="shimmer" style={{ width: '60%', height: 12, borderRadius: 6 }} />
        <Skeleton variant="shimmer" style={{ width: '45%', height: 12, borderRadius: 6 }} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ExchangeCardSkeleton
// ---------------------------------------------------------------------------

export function ExchangeCardSkeleton(): React.JSX.Element {
  return (
    <View
      className="bg-surface rounded-2xl mx-4 my-1.5 p-4 gap-2"
      style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 }}
    >
      <Skeleton variant="shimmer" style={{ width: '75%', height: 16, borderRadius: 6 }} />
      <Skeleton variant="shimmer" style={{ width: '100%', height: 12, borderRadius: 6 }} />
      <View className="flex-row gap-4">
        <Skeleton variant="shimmer" style={{ width: 60, height: 12, borderRadius: 6 }} />
        <Skeleton variant="shimmer" style={{ width: 40, height: 12, borderRadius: 6 }} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ProfileSkeleton
// ---------------------------------------------------------------------------

export function ProfileSkeleton(): React.JSX.Element {
  return (
    <View className="px-5 pt-6">
      <View className="items-center">
        <Skeleton variant="shimmer" style={{ width: 88, height: 88, borderRadius: 44 }} />
        <Skeleton variant="shimmer" style={{ width: 120, height: 16, borderRadius: 8, marginTop: 12 }} />
        <Skeleton variant="shimmer" style={{ width: 80, height: 12, borderRadius: 6, marginTop: 6 }} />
      </View>
      <Skeleton variant="shimmer" style={{ width: '100%', height: 90, borderRadius: 14, marginTop: 24 }} />
      <View className="gap-3 mt-5">
        <Skeleton variant="shimmer" style={{ width: '100%', height: 46, borderRadius: 10 }} />
        <Skeleton variant="shimmer" style={{ width: '100%', height: 46, borderRadius: 10 }} />
        <Skeleton variant="shimmer" style={{ width: '100%', height: 46, borderRadius: 10 }} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ListSkeleton
// ---------------------------------------------------------------------------

/**
 * The shape of a loading list, for screens with no card skeleton of their own.
 *
 * 🔴 Why this exists. Five of the app's busiest lists — notifications, marketplace,
 * volunteering, jobs and the wallet — showed a single centred spinner on a blank screen
 * while they loaded. A spinner says "wait" and nothing else: it gives no sense of how much
 * is coming, and the screen jumps when the real rows land. The tabs already had card
 * skeletons and read as noticeably faster for it, even though they are not.
 * Audit 2026-09-09, item 11.
 *
 * Deliberately generic. A bespoke skeleton per screen is better where the row has a strong
 * shape (the feed, a conversation, an event); this is for the rest, where the alternative
 * is a spinner.
 */
export function ListSkeleton({
  rows = 4,
  showLeadingCircle = false,
  testID,
}: {
  rows?: number;
  /** Set on lists whose rows lead with an avatar or an icon bubble. */
  showLeadingCircle?: boolean;
  testID?: string;
}): React.JSX.Element {
  return (
    <View className="gap-2 px-4 py-3" testID={testID}>
      {Array.from({ length: rows }, (_, index) => (
        <View
          key={index}
          className="flex-row items-start gap-3 rounded-2xl bg-surface p-4"
          style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 }}
        >
          {showLeadingCircle ? (
            <Skeleton variant="shimmer" style={{ width: 40, height: 40, borderRadius: 20 }} />
          ) : null}
          <View className="flex-1 gap-2">
            <Skeleton variant="shimmer" style={{ width: '70%', height: 14, borderRadius: 6 }} />
            <Skeleton variant="shimmer" style={{ width: '100%', height: 11, borderRadius: 6 }} />
            <Skeleton variant="shimmer" style={{ width: '45%', height: 11, borderRadius: 6 }} />
          </View>
        </View>
      ))}
    </View>
  );
}
