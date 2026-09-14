// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState } from 'react';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button as HeroButton } from '@/components/ui/NativeButton';

export interface VideoProgress {
  currentTime: number;
  duration: number;
  finished?: boolean;
}

/** Hook-owned native player releases its resources when the source or screen changes. */
export default function NativeVideo({ source, onProgress, style, ...viewProps }: {
  source: VideoSource;
  onProgress?: (progress: VideoProgress) => void;
  testID?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation('common');
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const player = useVideoPlayer(source, instance => { instance.timeUpdateEventInterval = 0.5; });
  useEventListener(player, 'statusChange', ({ status }) => {
    setFailed(status === 'error');
    if (status === 'error' || status === 'readyToPlay') setRetrying(false);
  });
  useEventListener(player, 'timeUpdate', event => {
    onProgress?.({ currentTime: event.currentTime, duration: player.duration });
  });
  useEventListener(player, 'playToEnd', () => {
    onProgress?.({ currentTime: player.duration, duration: player.duration, finished: true });
  });

  async function retry() {
    if (retrying) return;
    setRetrying(true);
    setFailed(false);
    try {
      await player.replaceAsync(source);
    } catch {
      setFailed(true);
      setRetrying(false);
    }
  }

  return (
    <View style={[style, { overflow: 'hidden' }]}>
      <VideoView
        {...viewProps}
        style={StyleSheet.absoluteFill}
        player={player}
        nativeControls
        contentFit="contain"
        pointerEvents={failed ? 'none' : 'auto'}
        importantForAccessibility={failed ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={failed}
      />
      {failed ? (
        <View
          testID={viewProps.testID ? `${viewProps.testID}-error` : undefined}
          style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20, backgroundColor: 'rgba(0,0,0,0.82)' }]}
        >
          <Text accessibilityRole="alert" style={{ color: '#fff', textAlign: 'center' }}>
            {t('errors.loadFailedSubtitle')}
          </Text>
          <HeroButton size="sm" variant="secondary" isDisabled={retrying} onPress={() => void retry()}>
            <HeroButton.Label>{t('buttons.retry')}</HeroButton.Label>
          </HeroButton>
        </View>
      ) : null}
    </View>
  );
}
