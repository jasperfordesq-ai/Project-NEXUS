// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { View } from 'react-native';
import { Avatar as HeroAvatar } from 'heroui-native';
import type { AvatarSize } from 'heroui-native';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';

interface AvatarProps {
  uri: string | null | undefined;
  name: string | null | undefined;
  size?: number;
  /**
   * Hide this avatar from a screen reader. Use it wherever the person's name is read out
   * right beside the picture — otherwise the name is announced twice.
   */
  decorative?: boolean;
  showOnline?: boolean;
}

function sizeToToken(px: number): AvatarSize {
  if (px <= 30) return 'sm';
  if (px <= 50) return 'md';
  return 'lg';
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export default function Avatar({ uri, name, size = 40, showOnline = false, decorative = false }: AvatarProps) {
  const sizeToken = sizeToToken(size);
  const initials = getInitials(name);
  const resolvedUri = resolveImageUrl(uri);

  return (
    /*
      🔴 The hiding has to happen on THIS wrapper, not on `HeroAvatar`.

      `decorative` is for the common case where the person's name is read out right beside
      the picture; without it TalkBack said the name twice and then "Avatar". Passing
      `importantForAccessibility` to `HeroAvatar` was measured on a device and did NOT
      work — the library does not forward unknown props to its root view, so heroui's own
      "Avatar" description on the inner image survived. A plain `View` around it does.
    */
    <View
      style={{ position: 'relative', alignSelf: 'flex-start' }}
      importantForAccessibility={decorative ? 'no-hide-descendants' : undefined}
      accessibilityElementsHidden={decorative || undefined}
    >
      {/*
        🔴 `alt=""` is load-bearing. heroui's avatar primitive defaults `alt = 'Avatar'` and
        passes it as the image's accessible name, so EVERY avatar in the app announced
        itself as "Avatar" — measured on a device with TalkBack on 2026-08-24, where the
        feed read "E2E UserA" and then "Avatar". Neither our own label nor
        `importantForAccessibility` on an ancestor silenced it; only emptying `alt` does.
        The name, when it is wanted, comes from the wrapper's own label above.
      */}
      <HeroAvatar
        size={sizeToken}
        alt=""
        accessibilityLabel={decorative ? undefined : (name ?? undefined)}
      >
        {resolvedUri ? (
          <HeroAvatar.Image source={{ uri: resolvedUri }} />
        ) : null}
        {/*
          🔴 The initials are decoration, not information. Measured on the members directory
          with TalkBack on 2026-08-24: each row read "View E2E's profile", then "E2E", then a
          lone **"E"** — the fallback initial, announced as its own stop. Hiding it on the
          ancestor does not work (the same reason `alt` had to be emptied), so it is hidden
          here, where it is rendered.
        */}
        <HeroAvatar.Fallback
          /*
            🔴 `textProps`, not props on the Fallback itself. The initials are decoration —
            measured on the members directory with TalkBack on 2026-08-24, every row read
            "View E2E's profile" and then a lone **"E"**. heroui spreads `textProps` onto the
            Text that actually holds the letters, and that is the only place the hiding
            sticks: accessibility props on the Fallback, on `HeroAvatar`, and on an ancestor
            View were all tried on the device and all ignored.
          */
          textProps={{ importantForAccessibility: 'no', accessibilityElementsHidden: true }}
        >
          {initials}
        </HeroAvatar.Fallback>
      </HeroAvatar>
      {showOnline ? (
        <View
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: '#22c55e',
            borderWidth: 2,
            borderColor: '#fff',
          }}
        />
      ) : null}
    </View>
  );
}
