// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import { Button as HeroButton, Spinner } from 'heroui-native';
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
  durationSeconds?: number | null;
  primaryColor: string;
}

/**
 * 🔴 Background playback is configured HERE, not once at startup, and the whole audio mode
 * is spelled out rather than patched.
 *
 * `Audio.setAudioModeAsync` merges into whatever the last caller left behind, app-wide.
 * The message thread turns `allowsRecordingIOS` on to record a voice note and never turns
 * it off, and on iOS that setting makes every later playback quiet and route to the
 * earpiece. Passing the full mode means an episode sounds the same whether or not the
 * member recorded a voice message earlier in the session.
 *
 * `staysActiveInBackground` is what keeps a 45-minute episode alive when the phone locks:
 * with it false — the default, and what shipped — expo-av explicitly pauses every sound on
 * host pause. iOS additionally needs `UIBackgroundModes: ["audio"]`, which is in app.json,
 * and it REFUSES the combination of `staysActiveInBackground: true` with
 * `playsInSilentModeIOS: false`, so those two move together.
 *
 * 🔴 Android has no media foreground service here, and this does not add one. expo-av
 * ships neither a service nor a wake lock, so what this changes on Android is that the app
 * stops pausing itself; the system may still stop a long episode with the screen off. A
 * real media notification belongs with the expo-audio port (expo-av is removed in SDK 55).
 */
const BACKGROUND_AUDIO_MODE = {
  allowsRecordingIOS: false,
  playsInSilentModeIOS: true,
  staysActiveInBackground: true,
  shouldDuckAndroid: true,
  playThroughEarpieceAndroid: false,
} as const;

function PodcastAudioPlayer(
  { episodeId, audioUrl, durationSeconds, primaryColor }: PodcastAudioPlayerProps,
  ref: React.Ref<PodcastAudioPlayerHandle>,
) {
  const { t } = useTranslation('podcasts');
  const theme = useTheme();
  const accentForeground = useAccentForeground();
  const soundRef = useRef<Audio.Sound | null>(null);
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
      if (cancelled || !seconds) return;
      setResumeFromMs(seconds * 1000);
      setPosition(seconds * 1000);
    });
    return () => { cancelled = true; };
  }, [episodeId, durationSeconds]);

  useEffect(() => () => {
    const sound = soundRef.current;
    soundRef.current = null;
    // Leaving the screen mid-episode is the commonest way to stop listening, so it is the
    // most important moment to remember the position.
    void savePodcastPosition(episodeId, lastPositionRef.current / 1000, durationRef.current).catch(() => undefined);
    void sound?.unloadAsync().catch(() => undefined);
  }, [episodeId]);

  const update = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    setPosition(status.positionMillis);
    lastPositionRef.current = status.positionMillis;
    if (status.durationMillis) setDuration(status.durationMillis);
    setIsPlaying(status.isPlaying);
    if (status.didJustFinish) {
      const finalMillis = status.durationMillis ?? duration;
      setPosition(finalMillis);
      void clearPodcastPosition(episodeId).catch(() => undefined);
      void recordPodcastListen(episodeId, { position_seconds: Math.round(finalMillis / 1000), completed: true }).catch(() => undefined);
      return;
    }
    const now = Date.now();
    if (status.isPlaying && now - lastSaveAtRef.current >= POSITION_SAVE_INTERVAL_MS) {
      lastSaveAtRef.current = now;
      void savePodcastPosition(episodeId, status.positionMillis / 1000, durationRef.current).catch(() => undefined);
    }
  }, [duration, episodeId]);

  /**
   * Load the episode and start it at `startAtMillis`. expo-av takes the start point in the
   * initial status, so a resume is a single load rather than a load followed by a visible
   * jump from zero.
   */
  const load = useCallback(async (startAtMillis: number) => {
    setIsLoading(true);
    try {
      await Audio.setAudioModeAsync(BACKGROUND_AUDIO_MODE);
      const { sound } = await Audio.Sound.createAsync(
        { uri: mediaUrl(audioUrl) },
        { shouldPlay: true, positionMillis: Math.max(0, Math.round(startAtMillis)) },
        update,
      );
      soundRef.current = sound;
      setIsLoaded(true);
      setIsPlaying(true);
      setResumeFromMs(0);
      lastPositionRef.current = startAtMillis;
      lastSaveAtRef.current = Date.now();
      void recordPodcastListen(episodeId, { position_seconds: Math.round(startAtMillis / 1000), completed: false }).catch(() => undefined);
    } finally {
      setIsLoading(false);
    }
  }, [audioUrl, episodeId, update]);

  const toggle = useCallback(async () => {
    setFailed(false);
    try {
      const sound = soundRef.current;
      if (sound) {
        if (isPlaying) {
          await sound.pauseAsync();
          setIsPlaying(false);
          // A pause is a deliberate stopping point — record it without waiting for the
          // next interval tick, which would never come.
          void savePodcastPosition(episodeId, lastPositionRef.current / 1000, durationRef.current).catch(() => undefined);
        } else {
          await sound.playAsync();
          setIsPlaying(true);
        }
        return;
      }
      await load(resumeFromMs);
    } catch {
      setFailed(true);
      setIsPlaying(false);
    }
  }, [episodeId, isPlaying, load, resumeFromMs]);

  const seekTo = useCallback(async (targetMillis: number) => {
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
      await sound.setPositionAsync(target);
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
        <HeroButton size="sm" variant="tertiary" accessibilityLabel={t('player.skip_back')} onPress={() => void seekTo(position - SKIP_BACK_MS)}>
          <HeroButton.Label>{t('player.skip_back')}</HeroButton.Label>
        </HeroButton>
        <HeroButton size="sm" variant="tertiary" accessibilityLabel={t('player.skip_forward')} onPress={() => void seekTo(position + SKIP_FORWARD_MS)}>
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
