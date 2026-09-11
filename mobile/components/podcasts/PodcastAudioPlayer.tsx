// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { setAudioModeAsync, type AudioStatus } from 'expo-audio';
import { Spinner } from 'heroui-native';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { useTranslation } from 'react-i18next';

import { Ionicons } from '@/components/ui/Icon';
import { API_BASE_URL } from '@/lib/constants';
import { recordPodcastListen } from '@/lib/api/podcasts';
import {
  clearPodcastPosition,
  loadPodcastPosition,
  savePodcastPosition,
} from '@/lib/podcasts/playbackPositions';
import { useTheme } from '@/lib/hooks/useTheme';
import { useAccentForeground } from '@/lib/theme/accentForeground';
import { loadAudioPlayer } from '@/lib/media/loadAudioPlayer';

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

/** The conventional podcast jumps: a short one back, a longer one forward. */
const SKIP_BACK_MS = 15_000;
const SKIP_FORWARD_MS = 30_000;

/**
 * How often the resume mark is written. Playback status arrives several times a second and
 * every write is an encrypted keychain round-trip, so writing on each one would be wasteful
 * for a value that only needs to be roughly right.
 */
const POSITION_SAVE_INTERVAL_MS = 5_000;

export interface PodcastAudioPlayerHandle {
  /** Move playback to this point, loading the episode first if it has not started. */
  seekToSeconds(seconds: number): void;
}

interface PodcastAudioPlayerProps {
  episodeId: number;
  audioUrl: string;
  episodeTitle?: string;
  showTitle?: string;
  durationSeconds?: number | null;
  primaryColor: string;
}

/** Reset recording mode and enable the native background playback session. */
const BACKGROUND_AUDIO_MODE = {
  allowsRecording: false,
  playsInSilentMode: true,
  shouldPlayInBackground: true,
  interruptionMode: 'duckOthers',
  shouldRouteThroughEarpiece: false,
} as const;

function PodcastAudioPlayer(
  { episodeId, audioUrl, episodeTitle, showTitle, durationSeconds, primaryColor }: PodcastAudioPlayerProps,
  ref: React.Ref<PodcastAudioPlayerHandle>,
) {
  const { t } = useTranslation('podcasts');
  const theme = useTheme();
  const accentForeground = useAccentForeground();
  const soundRef = useRef<Awaited<ReturnType<typeof loadAudioPlayer>> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const loadingRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState((durationSeconds ?? 0) * 1000);
  /** The mark restored from the device, in ms. Cleared once playback actually starts. */
  const [resumeFromMs, setResumeFromMs] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);

  /* Written from the status callback so the unmount cleanup can save the last position
     without re-running the effect (and tearing the sound down) on every tick. */
  const lastPositionRef = useRef(0);
  const lastSaveAtRef = useRef(0);
  /* The episode's real length, once known. It decides whether a position counts as
     "finished" and so should clear the resume mark instead of setting it. */
  const durationRef = useRef<number | null>(durationSeconds ?? null);
  useEffect(() => {
    durationRef.current = durationSeconds ?? (duration > 0 ? Math.round(duration / 1000) : null);
  }, [durationSeconds, duration]);

  useEffect(() => {
    let cancelled = false;
    void loadPodcastPosition(episodeId, durationSeconds ?? null).then((seconds) => {
      if (cancelled || !seconds || loadingRef.current || soundRef.current) return;
      setResumeFromMs(seconds * 1000);
      setPosition(seconds * 1000);
    });
    return () => { cancelled = true; };
  }, [episodeId, durationSeconds]);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsPlaying(false);
    setIsLoading(false);
    setIsLoaded(false);
    setFailed(false);
    setPosition(0);
    setResumeFromMs(0);
    lastPositionRef.current = 0;
    return () => {
      controller.abort();
      const sound = soundRef.current;
      soundRef.current = null;
      // Save the final playback position when leaving this episode.
      void savePodcastPosition(episodeId, lastPositionRef.current / 1000, durationRef.current).catch(() => undefined);
      sound?.release();
      loadingRef.current = false;
    };
  }, [episodeId, audioUrl]);

  const update = useCallback((status: AudioStatus) => {
    if (status.playbackState === 'failed' || status.playbackState === 'error') {
      soundRef.current?.release();
      soundRef.current = null;
      setIsPlaying(false);
      setIsLoaded(false);
      setResumeFromMs(lastPositionRef.current);
      setFailed(true);
      return;
    }
    if (!status.isLoaded) return;
    setPosition(status.currentTime * 1000);
    lastPositionRef.current = status.currentTime * 1000;
    if (status.duration) setDuration(status.duration * 1000);
    setIsPlaying(status.playing);
    if (status.didJustFinish) {
      const finalMillis = status.duration ? status.duration * 1000 : duration;
      setPosition(finalMillis);
      void clearPodcastPosition(episodeId).catch(() => undefined);
      void recordPodcastListen(episodeId, { position_seconds: Math.round(finalMillis / 1000), completed: true }).catch(() => undefined);
      return;
    }
    const now = Date.now();
    if (status.playing && now - lastSaveAtRef.current >= POSITION_SAVE_INTERVAL_MS) {
      lastSaveAtRef.current = now;
      void savePodcastPosition(episodeId, status.currentTime, durationRef.current).catch(() => undefined);
    }
  }, [duration, episodeId]);

  /** Load and seek before playback so a resume never starts audibly at zero. */
  const load = useCallback(async (startAtMillis: number) => {
    const controller = controllerRef.current;
    if (!controller || controller.signal.aborted || loadingRef.current) return;
    loadingRef.current = true;
    setIsLoading(true);
    try {
      await setAudioModeAsync(BACKGROUND_AUDIO_MODE);
      if (controller.signal.aborted) return;
      const sound = await loadAudioPlayer(
        { uri: mediaUrl(audioUrl) },
        update,
        controller.signal,
      );
      if (controller.signal.aborted) { sound.release(); return; }
      soundRef.current = sound;
      await sound.player.seekTo(Math.max(0, startAtMillis / 1000));
      if (controller.signal.aborted) return;
      sound.player.setActiveForLockScreen(true, { title: episodeTitle, artist: showTitle });
      sound.player.play();
      setIsLoaded(true);
      setIsPlaying(true);
      setResumeFromMs(0);
      lastPositionRef.current = startAtMillis;
      lastSaveAtRef.current = Date.now();
      void recordPodcastListen(episodeId, { position_seconds: Math.round(startAtMillis / 1000), completed: false }).catch(() => undefined);
    } catch (error) {
      if (controller.signal.aborted) return;
      soundRef.current?.release();
      soundRef.current = null;
      throw error;
    } finally {
      if (controllerRef.current === controller) loadingRef.current = false;
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, [audioUrl, episodeId, episodeTitle, showTitle, update]);

  const toggle = useCallback(async () => {
    if (loadingRef.current) return;
    setFailed(false);
    try {
      const sound = soundRef.current;
      if (sound) {
        if (isPlaying) {
          sound.player.pause();
          setIsPlaying(false);
          // A pause is a deliberate stopping point — record it without waiting for the
          // next interval tick, which would never come.
          void savePodcastPosition(episodeId, lastPositionRef.current / 1000, durationRef.current).catch(() => undefined);
        } else {
          if (duration > 0 && lastPositionRef.current >= duration) await sound.player.seekTo(0);
          if (controllerRef.current?.signal.aborted) return;
          sound.player.play();
          setIsPlaying(true);
        }
        return;
      }
      await load(resumeFromMs);
    } catch {
      setFailed(true);
      setIsPlaying(false);
    }
  }, [duration, episodeId, isPlaying, load, resumeFromMs]);

  const seekTo = useCallback(async (targetMillis: number) => {
    if (loadingRef.current) return;
    const ceiling = duration > 0 ? duration : Number.MAX_SAFE_INTEGER;
    const target = Math.min(Math.max(0, targetMillis), ceiling);
    setFailed(false);
    try {
      const sound = soundRef.current;
      if (!sound) {
        // Nothing loaded yet: jumping to a chapter should start the episode there rather
        // than silently moving a progress bar that is not attached to anything.
        await load(target);
        return;
      }
      await sound.player.seekTo(target / 1000);
      if (controllerRef.current?.signal.aborted) return;
      setPosition(target);
      lastPositionRef.current = target;
      void savePodcastPosition(episodeId, target / 1000, durationRef.current).catch(() => undefined);
    } catch {
      setFailed(true);
    }
  }, [duration, episodeId, load]);

  useImperativeHandle(ref, () => ({
    seekToSeconds(seconds: number) { void seekTo(seconds * 1000); },
  }), [seekTo]);

  const startOver = useCallback(async () => {
    if (loadingRef.current) return;
    setResumeFromMs(0);
    setPosition(0);
    lastPositionRef.current = 0;
    await clearPodcastPosition(episodeId).catch(() => undefined);
    await seekTo(0);
  }, [episodeId, seekTo]);

  const percent = duration > 0 ? Math.min(100, Math.max(0, position / duration * 100)) : 0;
  const playLabel = isPlaying
    ? t('player.pause')
    : resumeFromMs > 0 && !isLoaded
      ? t('player.resume_from', { time: clock(resumeFromMs) })
      : t('player.play');

  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-3">
        <HeroButton isIconOnly accessibilityLabel={playLabel} isDisabled={isLoading} onPress={() => void toggle()}>
          {isLoading ? <Spinner size="sm" /> : <Ionicons name={isPlaying ? 'pause' : 'play'} size={20} color={accentForeground} />}
        </HeroButton>
        <View className="min-w-0 flex-1">
          <View accessibilityRole="progressbar" accessibilityLabel={t('player.progress')} accessibilityValue={{ min: 0, max: 100, now: Math.round(percent) }} className="h-2.5 overflow-hidden rounded-full bg-default-200">
            <View className="h-2.5 rounded-full" style={{ width: `${percent}%`, backgroundColor: primaryColor }} />
          </View>
          <Text className="mt-1 text-xs" style={{ color: theme.textSecondary }}>{clock(position)} / {duration > 0 ? clock(duration) : t('player.duration_unknown')}</Text>
        </View>
      </View>
      <View className="flex-row flex-wrap items-center gap-2">
        <HeroButton size="sm" variant="tertiary" isDisabled={isLoading} accessibilityLabel={t('player.skip_back')} onPress={() => void seekTo(position - SKIP_BACK_MS)}>
          <HeroButton.Label>{t('player.skip_back')}</HeroButton.Label>
        </HeroButton>
        <HeroButton size="sm" variant="tertiary" isDisabled={isLoading} accessibilityLabel={t('player.skip_forward')} onPress={() => void seekTo(position + SKIP_FORWARD_MS)}>
          <HeroButton.Label>{t('player.skip_forward')}</HeroButton.Label>
        </HeroButton>
        {resumeFromMs > 0 || position > 0 ? (
          <HeroButton size="sm" variant="tertiary" accessibilityLabel={t('player.start_over')} onPress={() => void startOver()}>
            <HeroButton.Label>{t('player.start_over')}</HeroButton.Label>
          </HeroButton>
        ) : null}
      </View>
      {failed ? (
        <View className="gap-2">
          <Text accessibilityRole="alert" style={{ color: theme.error }}>{t('player.load_error')}</Text>
          <View className="flex-row">
            <HeroButton size="sm" variant="secondary" onPress={() => void toggle()}>
              <HeroButton.Label>{t('player.retry')}</HeroButton.Label>
            </HeroButton>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const PodcastAudioPlayerWithRef = forwardRef<PodcastAudioPlayerHandle, PodcastAudioPlayerProps>(PodcastAudioPlayer);
PodcastAudioPlayerWithRef.displayName = 'PodcastAudioPlayer';

export default PodcastAudioPlayerWithRef;
