// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';
import type { StyleProp, ViewStyle } from 'react-native';

export interface VideoProgress {
  currentTime: number;
  duration: number;
  finished?: boolean;
}

/** Hook-owned native player releases its resources when the source or screen changes. */
export default function NativeVideo({ source, onProgress, ...viewProps }: {
  source: VideoSource;
  onProgress?: (progress: VideoProgress) => void;
  testID?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const player = useVideoPlayer(source, instance => { instance.timeUpdateEventInterval = 0.5; });
  useEventListener(player, 'timeUpdate', event => {
    onProgress?.({ currentTime: event.currentTime, duration: player.duration });
  });
  useEventListener(player, 'playToEnd', () => {
    onProgress?.({ currentTime: player.duration, duration: player.duration, finished: true });
  });
  return <VideoView {...viewProps} player={player} nativeControls contentFit="contain" />;
}
