// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { contrastText, withAlpha } from '@/lib/utils/color';
import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@/components/ui/Icon';
import { Spinner } from 'heroui-native';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { setAudioModeAsync, type AudioStatus } from 'expo-audio';
import { loadAudioPlayer } from '@/lib/media/loadAudioPlayer';

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
  const soundRef = useRef<Awaited<ReturnType<typeof loadAudioPlayer>> | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const finished = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [totalMs, setTotalMs] = useState(durationMs ?? 0);

  // A recycled message must never retain another message's audio or a pending load.
  useEffect(() => {
    const controller = new AbortController();
    loadController.current = controller;
    setIsPlaying(false);
    setIsLoading(false);
    setPositionMs(0);
    setTotalMs(durationMs ?? 0);
    setHasError(false);
    finished.current = false;
    return () => {
      controller.abort();
      soundRef.current?.release();
      soundRef.current = null;
      inFlight.current = false;
    };
  }, [audioUrl, durationMs]);

  const onPlaybackStatusUpdate = useCallback((status: AudioStatus) => {
    if (status.playbackState === 'error' || status.playbackState === 'failed') {
      soundRef.current = null;
      setHasError(true);
      setIsPlaying(false);
      return;
    }
    if (!status.isLoaded) return;
    setPositionMs(status.currentTime * 1000);
    if (status.duration) setTotalMs(status.duration * 1000);
    setIsPlaying(status.playing);
    if (status.didJustFinish) {
      finished.current = true;
      setIsPlaying(false);
      setPositionMs(0);
    }
  }, []);

  const handlePlayPause = useCallback(async () => {
    if (inFlight.current) return;
    const controller = loadController.current;
    if (!controller || controller.signal.aborted) return;
    inFlight.current = true;
    setHasError(false);
    try {
      if (soundRef.current) {
        if (isPlaying) {
          soundRef.current.player.pause();
          setIsPlaying(false);
        } else {
          if (finished.current) {
            await soundRef.current.player.seekTo(0);
            finished.current = false;
          }
          if (controller.signal.aborted) return;
          soundRef.current?.player.play();
          setIsPlaying(true);
        }
        return;
      }

      // First play — load the sound
      setIsLoading(true);
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false, shouldPlayInBackground: false, shouldRouteThroughEarpiece: false, interruptionMode: 'doNotMix' });
      if (controller.signal.aborted) return;
      const source = await authenticatedMediaRequest(audioUrl);
      if (controller.signal.aborted) return;
      const sound = await loadAudioPlayer(source, onPlaybackStatusUpdate, controller.signal);
      if (controller.signal.aborted) { sound.release(); return; }
      soundRef.current = sound;
      sound.player.play();
      setIsPlaying(true);
    } catch {
      if (controller.signal.aborted) return;
      soundRef.current?.release();
      soundRef.current = null;
      setHasError(true);
      setIsPlaying(false);
    } finally {
      if (loadController.current === controller) {
        inFlight.current = false;
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }
  }, [audioUrl, isPlaying, onPlaybackStatusUpdate]);

  // theme kept only for border color in waveform (dynamic unfilled bar color depends on isOwn + theme.border)
  const theme = useTheme();

  // Own bubbles are painted with the community colour, which can be pale: pick the
  // readable foreground for it instead of assuming white.
  const onPrimary = contrastText(primaryColor);
  const iconColor = isOwn ? withAlpha(onPrimary, 0.95) : primaryColor;
  const timeColor = isOwn ? withAlpha(onPrimary, 0.8) : textColorSecondary;
  const labelColor = isOwn ? onPrimary : textColor;
  const unfilledBarColor = isOwn ? withAlpha(onPrimary, 0.35) : theme.border;

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
                  ? iconColor
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
