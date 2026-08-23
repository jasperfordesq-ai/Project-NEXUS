// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Spinner } from 'heroui-native';
// TODO: Migrate from expo-av to expo-audio when SDK 55+ is adopted.
// expo-av is deprecated but expo-audio's API differs significantly (useAudioPlayer hook-based).
// The deprecation warning is suppressed via LogBox in _layout.tsx.
import { Audio, type AVPlaybackStatus } from 'expo-av';

import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/hooks/useTheme';
import { authenticatedMediaRequest } from '@/lib/api/client';

interface VoiceMessageBubbleProps {
  audioUrl: string;
  durationMs?: number;
  isOwn: boolean;
  primaryColor: string;
  textColor: string;
  textColorSecondary: string;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function VoiceMessageBubble({
  audioUrl,
  durationMs,
  isOwn,
  primaryColor,
  textColor,
  textColorSecondary,
}: VoiceMessageBubbleProps) {
  const { t } = useTranslation('messages');
  const soundRef = useRef<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [totalMs, setTotalMs] = useState(durationMs ?? 0);

  // Unload sound on unmount to free resources
  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => null);
    };
  }, []);

  const onPlaybackStatusUpdate = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    setPositionMs(status.positionMillis);
    if (status.durationMillis) setTotalMs(status.durationMillis);
    if (status.didJustFinish) {
      setIsPlaying(false);
      setPositionMs(0);
    }
  }, []);

  const handlePlayPause = useCallback(async () => {
    setHasError(false);
    try {
      if (soundRef.current) {
        if (isPlaying) {
          await soundRef.current.pauseAsync();
          setIsPlaying(false);
        } else {
          await soundRef.current.playAsync();
          setIsPlaying(true);
        }
        return;
      }

      // First play — load the sound
      setIsLoading(true);
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const source = await authenticatedMediaRequest(audioUrl);
      const { sound } = await Audio.Sound.createAsync(
        source,
        { shouldPlay: true },
        onPlaybackStatusUpdate,
      );
      soundRef.current = sound;
      setIsPlaying(true);
    } catch {
      setHasError(true);
      setIsPlaying(false);
    } finally {
      setIsLoading(false);
    }
  }, [audioUrl, isPlaying, onPlaybackStatusUpdate]);

  // theme kept only for border color in waveform (dynamic unfilled bar color depends on isOwn + theme.border)
  const theme = useTheme();

  const iconColor = isOwn ? 'rgba(255,255,255,0.95)' : primaryColor; // contrast on primary
  const timeColor = isOwn ? 'rgba(255,255,255,0.8)' : textColorSecondary; // contrast on primary
  const labelColor = isOwn ? '#fff' : textColor; // contrast on primary
  const unfilledBarColor = isOwn ? 'rgba(255,255,255,0.35)' : theme.border; // contrast on primary

  const progress = totalMs > 0 ? positionMs / totalMs : 0;
  const displayTime = isPlaying || positionMs > 0
    ? formatDuration(totalMs - positionMs)
    : totalMs > 0 ? formatDuration(totalMs) : '0:00';

  return (
    <View className="flex-row items-center gap-1.5 min-w-[180px]">
      <HeroButton
        isIconOnly
        variant="ghost"
        size="sm"
        onPress={handlePlayPause}
        isDisabled={isLoading}
        style={{ borderColor: iconColor }}
        className="w-8 h-8 rounded-full border-[1.5px] items-center justify-center"
        accessibilityLabel={isPlaying ? t('voice.pause') : t('voice.play')}
      >
        {isLoading ? (
          <Spinner size="sm" color={iconColor} />
        ) : (
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={18}
            color={iconColor}
          />
        )}
      </HeroButton>

      <View className="flex-1 flex-row items-center gap-0.5">
        {/* Simple waveform bar visualization */}
        {Array.from({ length: 20 }).map((_, i) => {
          const barHeight = 6 + ((i % 5) * 3) + (i % 3 === 0 ? 4 : 0);
          const filled = i / 20 <= progress;
          return (
            <View
              key={i}
              style={{
                flex: 1,
                height: barHeight,
                borderRadius: 2,
                backgroundColor: filled
                  ? (isOwn ? 'rgba(255,255,255,0.95)' : primaryColor) // contrast on primary
                  : unfilledBarColor,
              }}
            />
          );
        })}
      </View>

      <Text style={{ fontSize: 11, color: timeColor, minWidth: 30, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
        {displayTime}
      </Text>
      <Text style={{ fontSize: 11, opacity: 0.7, color: hasError ? theme.error : labelColor }}>
        {hasError ? t('voice.failed') : t('voice.label')}
      </Text>
    </View>
  );
}
