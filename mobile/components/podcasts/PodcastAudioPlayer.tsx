// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import { Button as HeroButton, Spinner } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import { Ionicons } from '@/components/ui/Icon';
import { API_BASE_URL } from '@/lib/constants';
import { recordPodcastListen } from '@/lib/api/podcasts';
import { useTheme } from '@/lib/hooks/useTheme';
import { useAccentForeground } from '@/lib/theme/accentForeground';

function mediaUrl(value: string) {
  const resolved = new URL(value, `${new URL(API_BASE_URL).origin}/`);
  const localDevelopment = __DEV__ && /^(localhost|127\.0\.0\.1|10\.0\.[23]\.2)$/.test(resolved.hostname);
  if (resolved.protocol !== 'https:' && !localDevelopment) throw new Error('Podcast audio must use HTTPS.');
  return resolved.toString();
}

function clock(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function PodcastAudioPlayer({ episodeId, audioUrl, durationSeconds, primaryColor }: { episodeId: number; audioUrl: string; durationSeconds?: number | null; primaryColor: string }) {
  const { t } = useTranslation('podcasts');
  const theme = useTheme();
  const accentForeground = useAccentForeground();
  const soundRef = useRef<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState((durationSeconds ?? 0) * 1000);

  useEffect(() => () => { void soundRef.current?.unloadAsync().catch(() => undefined); }, []);

  const update = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    setPosition(status.positionMillis);
    if (status.durationMillis) setDuration(status.durationMillis);
    setIsPlaying(status.isPlaying);
    if (status.didJustFinish) {
      setPosition(status.durationMillis ?? duration);
      void recordPodcastListen(episodeId, { position_seconds: Math.round((status.durationMillis ?? duration) / 1000), completed: true }).catch(() => undefined);
    }
  }, [duration, episodeId]);

  async function toggle() {
    setFailed(false);
    try {
      if (soundRef.current) {
        if (isPlaying) await soundRef.current.pauseAsync();
        else await soundRef.current.playAsync();
        setIsPlaying(!isPlaying);
        return;
      }
      setIsLoading(true);
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: mediaUrl(audioUrl) }, { shouldPlay: true }, update);
      soundRef.current = sound;
      setIsPlaying(true);
      void recordPodcastListen(episodeId, { position_seconds: 0, completed: false }).catch(() => undefined);
    } catch {
      setFailed(true);
      setIsPlaying(false);
    } finally {
      setIsLoading(false);
    }
  }

  const percent = duration > 0 ? Math.min(100, Math.max(0, position / duration * 100)) : 0;
  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-3">
        <HeroButton isIconOnly accessibilityLabel={isPlaying ? t('player.pause') : t('player.play')} isDisabled={isLoading} onPress={() => void toggle()}>
          {isLoading ? <Spinner size="sm" /> : <Ionicons name={isPlaying ? 'pause' : 'play'} size={20} color={accentForeground} />}
        </HeroButton>
        <View className="min-w-0 flex-1">
          <View accessibilityRole="progressbar" accessibilityLabel={t('player.progress')} accessibilityValue={{ min: 0, max: 100, now: Math.round(percent) }} className="h-2.5 overflow-hidden rounded-full bg-default-200">
            <View className="h-2.5 rounded-full" style={{ width: `${percent}%`, backgroundColor: primaryColor }} />
          </View>
          <Text className="mt-1 text-xs" style={{ color: theme.textSecondary }}>{clock(position)} / {duration > 0 ? clock(duration) : t('player.duration_unknown')}</Text>
        </View>
      </View>
      {failed ? <Text accessibilityRole="alert" style={{ color: theme.error }}>{t('player.load_error')}</Text> : null}
    </View>
  );
}
