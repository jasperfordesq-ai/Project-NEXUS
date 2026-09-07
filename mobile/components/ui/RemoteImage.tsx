// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState } from 'react';
import { View, type StyleProp, type ImageStyle, type ViewStyle } from 'react-native';
import { Image, type ImageContentFit } from 'expo-image';

import { Ionicons } from '@/components/ui/Icon';
import { useTheme } from '@/lib/hooks/useTheme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface RemoteImageProps {
  uri: string | null | undefined;
  style?: StyleProp<ImageStyle>;
  className?: string;
  contentFit?: ImageContentFit;
  /** Icon shown when the picture cannot be loaded. Choose one that suits the surface. */
  fallbackIcon?: IoniconName;
  /** Screen-reader label. Omit for decoration that a nearby caption already names. */
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * A picture from the server, with an honest failure state.
 *
 * 🔴 Why this exists. Every remote image in the app was a bare `<Image>` with no `onError`
 * anywhere in the codebase (audit 2026-09-07, A/F-13). A photo that 404s, or one on a
 * community whose uploads directory is misconfigured, renders as a blank rectangle the
 * exact size of the picture — which reads as "the app is broken" rather than "this picture
 * is missing", and on a card it leaves a hole above the title that nothing explains.
 *
 * A failed load now shows a muted placeholder with an icon, on the surface colour, so the
 * card keeps its shape and the member can see the difference between a missing picture and
 * a broken screen. `onError` also fires for an unreachable host, which is the offline case.
 */
export default function RemoteImage({
  uri,
  style,
  className,
  contentFit = 'cover',
  fallbackIcon = 'image-outline',
  accessibilityLabel,
  testID,
}: RemoteImageProps) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);

  if (!uri || failed) {
    return (
      <View
        style={[style as StyleProp<ViewStyle>, { backgroundColor: theme.borderSubtle, alignItems: 'center', justifyContent: 'center' }]}
        className={className}
        testID={testID ? `${testID}-fallback` : undefined}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Ionicons name={fallbackIcon} size={28} color={theme.textMuted} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={style}
      className={className}
      contentFit={contentFit}
      onError={() => setFailed(true)}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    />
  );
}
