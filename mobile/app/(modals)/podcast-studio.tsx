// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Podcast Studio — native equivalent of
 * `react-frontend/src/pages/podcasts/PodcastStudioPage.tsx`.
 *
 * 🔴 The app's Create menu used to open the WEBSITE for this, which the owner
 * called out as confusing: every other create action in the app is native.
 *
 * Audio can be given either way the web studio allows: a file hosted by NEXUS, or
 * an external URL. The file path deliberately does NOT go through `api.upload()` —
 * an episode may be up to the tenant's ceiling (250 MB by default), and the shared
 * `fetch` client can report no progress and honour no cancel. See
 * `lib/api/uploadWithProgress.ts`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button as HeroButton, Card as HeroCard, TagGroup, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';

import * as Haptics from '@/lib/haptics';
import AppTopBar from '@/components/ui/AppTopBar';
import BottomSheet from '@/components/ui/BottomSheet';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import FeatureGate from '@/components/FeatureGate';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import PodcastShowStatsPanel from '@/components/podcasts/PodcastShowStatsPanel';
import TextArea from '@/components/ui/TextArea';
import { Chip } from '@/components/ui/StatusChip';
import { Ionicons } from '@/components/ui/Icon';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { describeApiError } from '@/lib/api/describeApiError';
import { isUploadAborted } from '@/lib/api/uploadWithProgress';
import { pickAudioFile, type PickedAudioFile } from '@/lib/media/pickAudioFile';
import { feedIssueKey } from '@/lib/podcasts/feedIssues';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { contrastText, withAlpha } from '@/lib/utils/color';
import { dateLocale } from '@/lib/utils/dateLocale';
import {
  archivePodcastEpisode,
  archivePodcastShow,
  createPodcastEpisode,
  createPodcastEpisodeWithAudio,
  createPodcastShow,
  deletePodcastEpisode,
  deletePodcastShow,
  getAuthoredPodcasts,
  publishPodcastEpisode,
  publishPodcastShow,
  updatePodcastEpisode,
  updatePodcastShow,
  uploadPodcastEpisodeCover,
  uploadPodcastShowArtwork,
  validatePodcastFeed,
  type CreatePodcastEpisodePayload,
  type CreatePodcastShowPayload,
  type PodcastChapter,
  type PodcastEpisode,
  type PodcastEpisodeType,
  type PodcastEpisodeVisibility,
  type PodcastFeedValidation,
  type PodcastShow,
  type PodcastStudioCapabilities,
  type PodcastVisibility,
} from '@/lib/api/podcasts';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const EPISODE_TYPES: PodcastEpisodeType[] = ['full', 'trailer', 'bonus'];

/* --- Chapter parsing, ported verbatim from the web studio so a chapter list
       typed on a phone lands in the database identically to one typed on the
       web. ------------------------------------------------------------------ */

function parseTimestamp(value: string): number {
  const parts = value.split(':').map((part) => Number.parseInt(part, 10));
  if (parts.some(Number.isNaN)) return 0;
  const [first = 0, second = 0, third = 0] = parts;
  if (parts.length === 3) return (first * 3600) + (second * 60) + third;
  if (parts.length === 2) return (first * 60) + second;
  return first;
}

function looksLikeTimestamp(token: string): boolean {
  return /^(?:\d+:)?\d{1,2}:\d{2}$/.test(token) || /^\d+$/.test(token);
}

function parseChapters(input: string): PodcastChapter[] {
  return input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [timestamp = '', ...titleParts] = line.split(/\s+/);
      const hasTimestamp = looksLikeTimestamp(timestamp);
      const title = titleParts.join(' ').trim();
      return {
        title: hasTimestamp ? (title || line) : line,
        starts_at_seconds: hasTimestamp ? parseTimestamp(timestamp) : 0,
        position: index,
      };
    });
}

function countInvalidChapterLines(input: string): number {
  return input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !looksLikeTimestamp(line.split(/\s+/)[0] ?? '')).length;
}

function formatChapterTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * The web form uses `<input type="datetime-local">`, which always hands over
 * `YYYY-MM-DDTHH:MM`. A phone has no such control, so members type the value —
 * and `new Date('2026-09-08 18:30')` is implementation-defined (Hermes and V8
 * disagree). Normalising the separator is the ONLY difference from the web
 * helper; everything after it is the same.
 */
function toApiDateTime(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const date = new Date(trimmed.replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Local `YYYY-MM-DD HH:MM` for the editor, from whatever the API stored. */
function toLocalDateTimeInput(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60_000));
  return local.toISOString().slice(0, 16).replace('T', ' ');
}

/** Fallbacks for when `GET /v2/podcasts/mine` meta has not been read yet. Same as the web studio. */
const DEFAULT_MAX_AUDIO_MB = 250;
const DEFAULT_AUDIO_MIMES = [
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/aac', 'audio/x-m4a',
  'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'video/webm',
];

function isAllowedExternalAudioUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function isRestrictedVisibility(value: unknown): value is 'members' | 'private' {
  return value === 'members' || value === 'private';
}

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : undefined;
}

type MediaTone = 'success' | 'warning' | 'danger' | 'default';

function mediaStatusTone(status?: string | null): MediaTone {
  if (!status || status === 'not_required') return 'default';
  if (status === 'complete' || status === 'clean') return 'success';
  if (status === 'failed' || status === 'blocked' || status === 'infected') return 'danger';
  return 'warning';
}

/**
 * HeroUI Native's Chip has no danger/warning variant, so the tone is carried by
 * the label colour. A blocked or infected scan must not read as an ordinary
 * status chip.
 */
function mediaToneStyle(tone: MediaTone, theme: ReturnType<typeof useTheme>): { color: string } | undefined {
  if (tone === 'danger') return { color: theme.error };
  if (tone === 'warning') return { color: theme.warning };
  if (tone === 'success') return { color: theme.success };
  return undefined;
}

function formatScheduledDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(dateLocale());
}

/**
 * Keep an option the row is ALREADY on, even when the community has since
 * switched that visibility off — otherwise the picker silently shows the wrong
 * current value and the first save quietly makes a private show public.
 */
function optionsWithCurrent<T extends string>(options: T[], current?: T): T[] {
  return current && !options.includes(current) ? [...options, current] : options;
}

type PendingImageUpload =
  | { kind: 'show'; showId: number; uri: string }
  | { kind: 'episode'; showId: number; episodeId: number; uri: string };

interface ShowFormState {
  title: string;
  category: string;
  authorName: string;
  ownerEmail: string;
  copyright: string;
  fundingUrl: string;
  language: string;
  visibility: PodcastVisibility;
  explicit: boolean;
  summary: string;
  description: string;
}

interface EpisodeFormState {
  title: string;
  audioUrl: string;
  episodeNumber: string;
  seasonNumber: string;
  visibility: PodcastEpisodeVisibility;
  durationSeconds: string;
  scheduledFor: string;
  episodeType: PodcastEpisodeType;
  summary: string;
  description: string;
  explicit: boolean;
  transcript: string;
  transcriptLanguage: string;
}

function emptyShowForm(language: string): ShowFormState {
  return {
    title: '',
    category: '',
    authorName: '',
    ownerEmail: '',
    copyright: '',
    fundingUrl: '',
    language,
    visibility: 'public',
    explicit: false,
    summary: '',
    description: '',
  };
}

function emptyEpisodeForm(language: string): EpisodeFormState {
  return {
    title: '',
    audioUrl: '',
    episodeNumber: '',
    seasonNumber: '',
    visibility: 'inherit',
    durationSeconds: '',
    scheduledFor: '',
    episodeType: 'full',
    summary: '',
    description: '',
    explicit: false,
    transcript: '',
    transcriptLanguage: language,
  };
}

export default function PodcastStudioRoute() {
  /*
    Gated like the React route (`<FeatureGate feature="podcasts">`). Hiding the "+"
    menu entry was never a gate: a deep link, a notification or a shared URL all
    reach this screen directly. See components/FeatureGate.tsx.
  */
  const { t } = useTranslation('podcasts');
  return (
    <FeatureGate feature="podcasts" title={t('studio.title')} fallbackHref="/(modals)/podcasts">
      <ModalErrorBoundary>
        <PodcastStudioScreen />
      </ModalErrorBoundary>
    </FeatureGate>
  );
}

function PodcastStudioScreen() {
  const { t } = useTranslation(['podcasts', 'common']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { tenant } = useTenant();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();

  const defaultLanguage = tenant?.default_language || 'en';
  const languages = tenant?.supported_languages?.length ? tenant.supported_languages : [defaultLanguage];

  const [shows, setShows] = useState<PodcastShow[]>([]);
  const [capabilities, setCapabilities] = useState<PodcastStudioCapabilities>({
    allow_member_show_creation: true,
    can_create_show: true,
    enable_private_shows: true,
    enable_transcripts: true,
    enable_chapters: true,
    enable_episode_reactions: true,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState<ShowFormState>(() => emptyShowForm('en'));
  const [showArtworkUri, setShowArtworkUri] = useState<string | null>(null);
  const [savingShow, setSavingShow] = useState(false);

  const [selectedShowId, setSelectedShowId] = useState<number | null>(null);
  const [episodeForm, setEpisodeForm] = useState<EpisodeFormState>(() => emptyEpisodeForm('en'));
  const [episodeCoverUri, setEpisodeCoverUri] = useState<string | null>(null);
  const [chaptersText, setChaptersText] = useState('');
  const [episodeError, setEpisodeError] = useState<string | null>(null);
  const [savingEpisode, setSavingEpisode] = useState(false);
  /*
    Hosted audio. `audioFile` is the file chosen off the device; when one is set it
    takes precedence over the URL field, matching the web studio, where a chosen file
    disables the URL input rather than racing it.
  */
  const [audioFile, setAudioFile] = useState<PickedAudioFile | null>(null);
  const [audioFileError, setAudioFileError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  const [editingShow, setEditingShow] = useState<PodcastShow | null>(null);
  const [editingShowForm, setEditingShowForm] = useState<ShowFormState>(() => emptyShowForm('en'));
  const [editingShowArtworkUri, setEditingShowArtworkUri] = useState<string | null>(null);
  const [editingEpisode, setEditingEpisode] = useState<{ showId: number; episode: PodcastEpisode } | null>(null);
  const [editingEpisodeForm, setEditingEpisodeForm] = useState<EpisodeFormState>(() => emptyEpisodeForm('en'));
  const [editingEpisodeCoverUri, setEditingEpisodeCoverUri] = useState<string | null>(null);
  const [editingChaptersText, setEditingChaptersText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [feedValidation, setFeedValidation] = useState<{ show: PodcastShow; result: PodcastFeedValidation } | null>(null);
  const [validatingShowId, setValidatingShowId] = useState<number | null>(null);
  const [pendingImageUpload, setPendingImageUpload] = useState<PendingImageUpload | null>(null);
  const [retryingImageUpload, setRetryingImageUpload] = useState(false);
  const [languageSeeded, setLanguageSeeded] = useState(false);

  // The tenant config arrives asynchronously; seed the two language fields once
  // it does, without clobbering a choice the member has already made.
  useEffect(() => {
    if (languageSeeded || !tenant) return;
    setShowForm((prev) => (prev.language === 'en' ? { ...prev, language: defaultLanguage } : prev));
    setEpisodeForm((prev) => (prev.transcriptLanguage === 'en' ? { ...prev, transcriptLanguage: defaultLanguage } : prev));
    setLanguageSeeded(true);
  }, [defaultLanguage, languageSeeded, tenant]);

  // 🔴 A show description and a typed transcript are exactly the kind of work a
  // stray Back has already destroyed elsewhere in this app (audit 2026-09-06).
  useUnsavedChangesGuard({
    isDirty: Boolean(showForm.title.trim() || episodeForm.title.trim()),
    isBusy: savingShow || savingEpisode,
    confirm,
    title: t('studio.unsaved_title'),
    message: t('studio.unsaved_message'),
    discardLabel: t('studio.discard'),
    cancelLabel: t('common:buttons.cancel'),
  });

  const loadShows = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await getAuthoredPodcasts();
      setShows(result.shows);
      // Upload limits and feature switches ride in `meta` — see getAuthoredPodcasts.
      setCapabilities((current) => ({ ...current, ...result.capabilities }));
      setSelectedShowId((current) => current ?? (result.shows[0]?.id ?? null));
    } catch (error) {
      setLoadError(describeApiError(error, t('studio.load_failed')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadShows();
    // A member who backs out mid-upload should not leave a request running.
    return () => uploadAbortRef.current?.abort();
  }, [loadShows]);

  /*
    The tenant's own audio limits, which arrive in the `meta` of GET /v2/podcasts/mine.
    The fallbacks are the platform defaults and matter: a community whose config has
    not been read yet must not silently accept a file the server will refuse.
  */
  const uploadLimits = useMemo(() => ({
    maxMb: capabilities.max_audio_size_mb && capabilities.max_audio_size_mb > 0
      ? capabilities.max_audio_size_mb
      : DEFAULT_MAX_AUDIO_MB,
    mimes: capabilities.allowed_audio_mimes?.length ? capabilities.allowed_audio_mimes : DEFAULT_AUDIO_MIMES,
  }), [capabilities.max_audio_size_mb, capabilities.allowed_audio_mimes]);

  const selectedShow = useMemo(
    () => shows.find((show) => show.id === selectedShowId) ?? null,
    [shows, selectedShowId],
  );

  const chapterIssues = useMemo(() => countInvalidChapterLines(chaptersText), [chaptersText]);

  const canCreateShow = capabilities.can_create_show
    ?? (capabilities.allow_member_show_creation !== false
      && (!capabilities.max_shows_per_user || shows.length < capabilities.max_shows_per_user));

  const readinessChecks = useMemo(() => {
    if (!selectedShow) return [];
    const hasPublishedEpisode = selectedShow.episodes?.some(
      (episode) => episode.status === 'published' && episode.moderation_status === 'approved',
    ) ?? false;

    return [
      {
        key: 'public_show',
        ok: selectedShow.visibility === 'public'
          && selectedShow.status === 'published'
          && selectedShow.moderation_status === 'approved',
      },
      { key: 'owner_email', ok: Boolean(selectedShow.owner_email) },
      { key: 'description', ok: Boolean(selectedShow.description || selectedShow.summary) },
      { key: 'artwork', ok: Boolean(selectedShow.artwork_url) },
      { key: 'published_episode', ok: hasPublishedEpisode },
    ];
  }, [selectedShow]);

  const visibilityOptions = useMemo<PodcastVisibility[]>(
    () => (capabilities.enable_private_shows === false ? ['public'] : ['public', 'members', 'private']),
    [capabilities.enable_private_shows],
  );

  const episodeVisibilityOptions = useMemo<PodcastEpisodeVisibility[]>(
    () => (capabilities.enable_private_shows === false
      ? ['inherit', 'public']
      : ['inherit', 'public', 'members', 'private']),
    [capabilities.enable_private_shows],
  );

  async function pickImage(onPicked: (uri: string) => void): Promise<void> {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showToast({ title: t('common:errors.alertTitle'), description: t('common:errors.generic'), variant: 'warning' });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
        allowsMultipleSelection: false,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const asset = result.assets[0];
      if (asset.mimeType && !ALLOWED_IMAGE_TYPES.includes(asset.mimeType)) {
        showToast({ title: t('common:errors.alertTitle'), description: t('studio.unsupported_file_type'), variant: 'warning' });
        return;
      }
      onPicked(asset.uri);
    } catch (error) {
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(error, t('common:errors.generic')), variant: 'danger' });
    }
  }

  async function handleCreateShow(): Promise<void> {
    if (!showForm.title.trim()) return;
    setSavingShow(true);
    try {
      const created = await createPodcastShow({
        title: showForm.title.trim(),
        summary: showForm.summary,
        description: showForm.description,
        language: showForm.language,
        category: showForm.category,
        author_name: showForm.authorName,
        owner_email: showForm.ownerEmail,
        copyright: showForm.copyright,
        funding_url: showForm.fundingUrl,
        explicit: showForm.explicit,
        visibility: showForm.visibility,
      });

      if (showArtworkUri && created?.id) {
        try {
          await uploadPodcastShowArtwork(created.id, showArtworkUri);
        } catch {
          // The show itself saved — keep the file so the banner can retry it.
          setPendingImageUpload({ kind: 'show', showId: created.id, uri: showArtworkUri });
          showToast({ title: t('studio.artwork_upload_failed'), variant: 'warning' });
        }
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('studio.show_created'), variant: 'success' });
      setShowForm(emptyShowForm(defaultLanguage));
      setShowArtworkUri(null);
      await loadShows();
      if (created?.id) setSelectedShowId(created.id);
    } catch (error) {
      showToast({ title: t('studio.save_failed'), description: describeApiError(error, t('studio.save_failed')), variant: 'danger' });
    } finally {
      setSavingShow(false);
    }
  }

  async function handlePickAudio(): Promise<void> {
    setAudioFileError(null);
    try {
      const result = await pickAudioFile(uploadLimits);
      if (result.status === 'cancelled') return;
      if (result.status === 'too_large') {
        setAudioFileError(t('studio.file_too_large', { max: result.maxMb }));
        return;
      }
      if (result.status === 'unsupported_type') {
        setAudioFileError(t('studio.unsupported_file_type'));
        return;
      }
      setAudioFile(result.file);
      // A hosted file wins over a URL, so clear the URL rather than leaving a stale
      // value the member cannot see being ignored.
      setEpisodeForm((prev) => ({ ...prev, audioUrl: '' }));
      setEpisodeError(null);
    } catch {
      // No picker available, or the system UI failed. Nothing was chosen.
      setAudioFileError(t('studio.unsupported_file_type'));
    }
  }

  function clearAudioFile(): void {
    setAudioFile(null);
    setAudioFileError(null);
  }

  function handleCancelUpload(): void {
    uploadAbortRef.current?.abort();
  }

  async function handleCreateEpisode(): Promise<void> {
    if (!selectedShow || !episodeForm.title.trim()) return;
    if (!audioFile && !episodeForm.audioUrl.trim()) return;
    if (!audioFile && !isAllowedExternalAudioUrl(episodeForm.audioUrl.trim())) {
      setEpisodeError(t('studio.audio_https_required'));
      return;
    }

    setSavingEpisode(true);
    setEpisodeError(null);
    try {
      const payload: CreatePodcastEpisodePayload = {
        title: episodeForm.title.trim(),
        audio_url: episodeForm.audioUrl.trim(),
        summary: episodeForm.summary,
        description: episodeForm.description,
        duration_seconds: optionalNumber(episodeForm.durationSeconds),
        episode_number: optionalNumber(episodeForm.episodeNumber),
        season_number: optionalNumber(episodeForm.seasonNumber),
        explicit: episodeForm.explicit,
        episode_type: episodeForm.episodeType,
        visibility: episodeForm.visibility,
        scheduled_for: toApiDateTime(episodeForm.scheduledFor),
        ...(capabilities.enable_chapters !== false ? { chapters: parseChapters(chaptersText) } : {}),
        ...(capabilities.enable_transcripts === false
          ? { transcript: '', transcript_language: '' }
          : { transcript: episodeForm.transcript, transcript_language: episodeForm.transcriptLanguage }),
      };
      let created: PodcastEpisode;
      if (audioFile) {
        const abortController = new AbortController();
        uploadAbortRef.current = abortController;
        setUploadProgress(0);
        try {
          // `audio_url` is dropped: the file is the source, and sending both would
          // make the API prefer the URL and ignore what was just uploaded.
          const { audio_url: _ignored, ...withoutUrl } = payload;
          created = await createPodcastEpisodeWithAudio(
            selectedShow.id,
            withoutUrl,
            audioFile,
            { onProgress: setUploadProgress, signal: abortController.signal },
          );
        } finally {
          uploadAbortRef.current = null;
          setUploadProgress(null);
        }
      } else {
        created = await createPodcastEpisode(selectedShow.id, payload);
      }

      if (episodeCoverUri && created?.id) {
        try {
          await uploadPodcastEpisodeCover(selectedShow.id, created.id, episodeCoverUri);
        } catch {
          setPendingImageUpload({ kind: 'episode', showId: selectedShow.id, episodeId: created.id, uri: episodeCoverUri });
          showToast({ title: t('studio.cover_upload_failed'), variant: 'warning' });
        }
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('studio.episode_created'), variant: 'success' });
      setEpisodeForm(emptyEpisodeForm(defaultLanguage));
      setEpisodeCoverUri(null);
      setAudioFile(null);
      setAudioFileError(null);
      setChaptersText('');
      await loadShows();
    } catch (error) {
      if (isUploadAborted(error)) {
        // The member stopped it. Keep the form and the chosen file so they can
        // simply press the button again — this is not a failure to report.
        showToast({ title: t('studio.upload_cancelled'), variant: 'warning' });
        return;
      }
      // The API answers with a specific reason (unsupported type, invalid URL,
      // schedule in the past) — show that, not a generic save error.
      const message = describeApiError(error, t('studio.save_failed'));
      setEpisodeError(message);
      showToast({ title: t('studio.save_failed'), description: message, variant: 'danger' });
    } finally {
      setSavingEpisode(false);
    }
  }

  async function runShowAction(action: () => Promise<unknown>, successKey: string): Promise<void> {
    try {
      await action();
      showToast({ title: t(successKey), variant: 'success' });
      await loadShows();
    } catch (error) {
      showToast({ title: t('studio.save_failed'), description: describeApiError(error, t('studio.save_failed')), variant: 'danger' });
    }
  }

  function handleArchiveShow(show: PodcastShow): void {
    confirm({
      title: t('studio.archive_show'),
      message: t('studio.confirm_archive_show', { title: show.title }),
      confirmLabel: t('studio.archive_show'),
      cancelLabel: t('actions.cancel'),
      variant: 'danger',
      onConfirm: () => runShowAction(() => archivePodcastShow(show.id), 'studio.show_archived'),
    });
  }

  function handleDeleteShow(show: PodcastShow): void {
    confirm({
      title: t('studio.delete_show'),
      message: t('studio.confirm_delete_show', { title: show.title }),
      confirmLabel: t('studio.delete_show'),
      cancelLabel: t('actions.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        setSelectedShowId((current) => (current === show.id ? null : current));
        await runShowAction(() => deletePodcastShow(show.id), 'studio.show_deleted');
      },
    });
  }

  function handleArchiveEpisode(showId: number, episode: PodcastEpisode): void {
    confirm({
      title: t('studio.archive_episode'),
      message: t('studio.confirm_archive_episode', { title: episode.title }),
      confirmLabel: t('studio.archive_episode'),
      cancelLabel: t('actions.cancel'),
      variant: 'danger',
      onConfirm: () => runShowAction(() => archivePodcastEpisode(showId, episode.id), 'studio.episode_archived'),
    });
  }

  function handleDeleteEpisode(showId: number, episode: PodcastEpisode): void {
    confirm({
      title: t('studio.delete_episode'),
      message: t('studio.confirm_delete_episode', { title: episode.title }),
      confirmLabel: t('studio.delete_episode'),
      cancelLabel: t('actions.cancel'),
      variant: 'danger',
      onConfirm: () => runShowAction(() => deletePodcastEpisode(showId, episode.id), 'studio.episode_deleted'),
    });
  }

  async function handleValidateFeed(show: PodcastShow): Promise<void> {
    setValidatingShowId(show.id);
    try {
      const result = await validatePodcastFeed(show.id);
      setFeedValidation({ show, result });
    } catch (error) {
      showToast({ title: t('studio.save_failed'), description: describeApiError(error, t('studio.save_failed')), variant: 'danger' });
    } finally {
      setValidatingShowId(null);
    }
  }

  function beginEditShow(show: PodcastShow): void {
    setEditingShowArtworkUri(null);
    setEditingShow(show);
    setEditingShowForm({
      title: show.title,
      category: show.category ?? '',
      authorName: show.author_name ?? '',
      ownerEmail: show.owner_email ?? '',
      copyright: show.copyright ?? '',
      fundingUrl: show.funding_url ?? '',
      language: show.language || defaultLanguage,
      visibility: show.visibility ?? 'public',
      explicit: show.explicit ?? false,
      summary: show.summary ?? '',
      description: show.description ?? '',
    });
  }

  async function handleUpdateShow(): Promise<void> {
    if (!editingShow || !editingShowForm.title.trim()) return;
    setSavingEdit(true);
    try {
      const payload: Partial<CreatePodcastShowPayload> = {
        title: editingShowForm.title.trim(),
        summary: editingShowForm.summary,
        description: editingShowForm.description,
        language: editingShowForm.language,
        category: editingShowForm.category,
        author_name: editingShowForm.authorName,
        owner_email: editingShowForm.ownerEmail,
        copyright: editingShowForm.copyright,
        funding_url: editingShowForm.fundingUrl,
        explicit: editingShowForm.explicit,
        visibility: editingShowForm.visibility,
      };
      // A show already sitting on a restricted visibility the community has
      // since switched off must not be forced public by an unrelated edit.
      if (capabilities.enable_private_shows === false
        && isRestrictedVisibility(editingShow.visibility)
        && payload.visibility === editingShow.visibility) {
        delete payload.visibility;
      }
      await updatePodcastShow(editingShow.id, payload);

      if (editingShowArtworkUri) {
        try {
          await uploadPodcastShowArtwork(editingShow.id, editingShowArtworkUri);
        } catch {
          setPendingImageUpload({ kind: 'show', showId: editingShow.id, uri: editingShowArtworkUri });
          showToast({ title: t('studio.artwork_upload_failed'), variant: 'warning' });
        }
      }

      showToast({ title: t('studio.show_updated'), variant: 'success' });
      setEditingShow(null);
      await loadShows();
    } catch (error) {
      showToast({ title: t('studio.save_failed'), description: describeApiError(error, t('studio.save_failed')), variant: 'danger' });
    } finally {
      setSavingEdit(false);
    }
  }

  function beginEditEpisode(showId: number, episode: PodcastEpisode): void {
    setEditingEpisodeCoverUri(null);
    setEditingEpisode({ showId, episode });
    setEditingEpisodeForm({
      title: episode.title,
      audioUrl: episode.hosted_audio ? '' : episode.audio_url,
      episodeNumber: episode.episode_number != null ? String(episode.episode_number) : '',
      seasonNumber: episode.season_number != null ? String(episode.season_number) : '',
      visibility: episode.visibility ?? 'inherit',
      durationSeconds: episode.duration_seconds != null ? String(episode.duration_seconds) : '',
      scheduledFor: toLocalDateTimeInput(episode.scheduled_for),
      episodeType: episode.episode_type ?? 'full',
      summary: episode.summary ?? '',
      description: episode.description ?? '',
      explicit: Boolean(episode.explicit),
      transcript: episode.transcript ?? '',
      transcriptLanguage: episode.transcript_language || defaultLanguage,
    });
    setEditingChaptersText((episode.chapters ?? [])
      .map((chapter) => `${formatChapterTime(chapter.starts_at_seconds)} ${chapter.title}`)
      .join('\n'));
  }

  async function handleUpdateEpisode(): Promise<void> {
    if (!editingEpisode || !editingEpisodeForm.title.trim()) return;
    const hostedAudio = Boolean(editingEpisode.episode.hosted_audio);
    const audioUrl = editingEpisodeForm.audioUrl.trim();
    if (!hostedAudio && audioUrl && !isAllowedExternalAudioUrl(audioUrl)) {
      showToast({ title: t('studio.audio_https_required'), variant: 'warning' });
      return;
    }

    setSavingEdit(true);
    try {
      const payload: Partial<CreatePodcastEpisodePayload> = {
        title: editingEpisodeForm.title.trim(),
        summary: editingEpisodeForm.summary,
        description: editingEpisodeForm.description,
        duration_seconds: optionalNumber(editingEpisodeForm.durationSeconds),
        episode_number: optionalNumber(editingEpisodeForm.episodeNumber),
        season_number: optionalNumber(editingEpisodeForm.seasonNumber),
        explicit: editingEpisodeForm.explicit,
        episode_type: editingEpisodeForm.episodeType,
        visibility: editingEpisodeForm.visibility,
        scheduled_for: toApiDateTime(editingEpisodeForm.scheduledFor),
        // NEXUS-hosted audio has no editable URL — sending one would replace a
        // stored file reference with a member's typed text.
        ...(hostedAudio ? {} : { audio_url: audioUrl }),
        ...(capabilities.enable_chapters !== false ? { chapters: parseChapters(editingChaptersText) } : {}),
        ...(capabilities.enable_transcripts === false
          ? {}
          : { transcript: editingEpisodeForm.transcript, transcript_language: editingEpisodeForm.transcriptLanguage }),
      };
      if (capabilities.enable_private_shows === false
        && isRestrictedVisibility(editingEpisode.episode.visibility)
        && payload.visibility === editingEpisode.episode.visibility) {
        delete payload.visibility;
      }
      await updatePodcastEpisode(editingEpisode.showId, editingEpisode.episode.id, payload);

      if (editingEpisodeCoverUri) {
        try {
          await uploadPodcastEpisodeCover(editingEpisode.showId, editingEpisode.episode.id, editingEpisodeCoverUri);
        } catch {
          setPendingImageUpload({
            kind: 'episode',
            showId: editingEpisode.showId,
            episodeId: editingEpisode.episode.id,
            uri: editingEpisodeCoverUri,
          });
          showToast({ title: t('studio.cover_upload_failed'), variant: 'warning' });
        }
      }

      showToast({ title: t('studio.episode_updated'), variant: 'success' });
      setEditingEpisode(null);
      await loadShows();
    } catch (error) {
      showToast({ title: t('studio.save_failed'), description: describeApiError(error, t('studio.save_failed')), variant: 'danger' });
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleRetryImageUpload(): Promise<void> {
    if (!pendingImageUpload) return;
    setRetryingImageUpload(true);
    try {
      if (pendingImageUpload.kind === 'show') {
        await uploadPodcastShowArtwork(pendingImageUpload.showId, pendingImageUpload.uri);
      } else {
        await uploadPodcastEpisodeCover(pendingImageUpload.showId, pendingImageUpload.episodeId, pendingImageUpload.uri);
      }
      showToast({
        title: pendingImageUpload.kind === 'show' ? t('studio.show_updated') : t('studio.episode_updated'),
        variant: 'success',
      });
      setPendingImageUpload(null);
      await loadShows();
    } catch {
      showToast({
        title: pendingImageUpload.kind === 'show' ? t('studio.artwork_upload_failed') : t('studio.cover_upload_failed'),
        variant: 'warning',
      });
    } finally {
      setRetryingImageUpload(false);
    }
  }

  const canSubmitEpisode = Boolean(selectedShow) && Boolean(episodeForm.title.trim())
    && (Boolean(audioFile) || Boolean(episodeForm.audioUrl.trim()));

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={t('studio.title')} backLabel={t('common:back')} fallbackHref="/(modals)/podcasts" />
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          className="flex-1"
          style={{ flex: 1, backgroundColor: theme.bg }}
          contentContainerStyle={{ flexGrow: 1, padding: 16, paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled"
        >
          <HeroCard className="mb-4 overflow-hidden rounded-panel p-0">
            <View className="h-1.5" style={{ backgroundColor: primary }} />
            <HeroCard.Body className="gap-2 p-4">
              <View className="flex-row items-start gap-3">
                <View className="size-13 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                  <Ionicons name="mic-outline" size={25} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-2xl font-bold" style={{ color: theme.text }}>{t('studio.title')}</Text>
                  <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('studio.subtitle')}</Text>
                </View>
              </View>
            </HeroCard.Body>
          </HeroCard>

          {pendingImageUpload ? (
            <HeroCard className="mb-4 rounded-panel p-0">
              <HeroCard.Body className="gap-3 p-4">
                <Text style={{ color: theme.warning }}>
                  {pendingImageUpload.kind === 'show' ? t('studio.artwork_upload_failed') : t('studio.cover_upload_failed')}
                </Text>
                <HeroButton variant="secondary" isDisabled={retryingImageUpload} onPress={() => void handleRetryImageUpload()}>
                  <HeroButton.Label>{t('studio.retry_upload')}</HeroButton.Label>
                </HeroButton>
              </HeroCard.Body>
            </HeroCard>
          ) : null}

          {loading ? (
            <View className="py-12">
              <LoadingSpinner />
            </View>
          ) : loadError ? (
            <EmptyState
              icon="warning-outline"
              title={t('studio.load_failed')}
              subtitle={loadError}
              actionLabel={t('studio.retry_load')}
              onAction={() => void loadShows()}
            />
          ) : (
            <>
              {canCreateShow ? (
                <HeroCard className="mb-4 rounded-panel p-0">
                  <HeroCard.Body className="gap-4 p-4">
                    <Text className="text-lg font-bold" style={{ color: theme.text }}>{t('studio.create_show')}</Text>
                    <Input label={t('fields.show_title')} maxLength={200} value={showForm.title} onChangeText={(title) => setShowForm((prev) => ({ ...prev, title }))} style={{ color: theme.text }} />
                    <Input label={t('fields.category')} value={showForm.category} onChangeText={(category) => setShowForm((prev) => ({ ...prev, category }))} style={{ color: theme.text }} />
                    <ImageField label={t('fields.artwork_file')} uri={showArtworkUri} onPress={() => void pickImage(setShowArtworkUri)} theme={theme} />
                    <Input label={t('fields.author_name')} value={showForm.authorName} onChangeText={(authorName) => setShowForm((prev) => ({ ...prev, authorName }))} style={{ color: theme.text }} />
                    <Input label={t('fields.owner_email')} keyboardType="email-address" autoCapitalize="none" value={showForm.ownerEmail} onChangeText={(ownerEmail) => setShowForm((prev) => ({ ...prev, ownerEmail }))} style={{ color: theme.text }} />
                    <Input label={t('fields.copyright')} value={showForm.copyright} onChangeText={(copyright) => setShowForm((prev) => ({ ...prev, copyright }))} style={{ color: theme.text }} />
                    <Input label={t('fields.funding_url')} keyboardType="url" autoCapitalize="none" value={showForm.fundingUrl} onChangeText={(fundingUrl) => setShowForm((prev) => ({ ...prev, fundingUrl }))} style={{ color: theme.text }} />
                    <OptionGroup label={t('fields.language')} values={languages} selected={showForm.language} onSelect={(language) => setShowForm((prev) => ({ ...prev, language }))} labelFor={(value) => value.toUpperCase()} primary={primary} theme={theme} />
                    <OptionGroup label={t('fields.visibility')} values={visibilityOptions} selected={showForm.visibility} onSelect={(visibility) => setShowForm((prev) => ({ ...prev, visibility }))} labelFor={(value) => t(`visibility.${value}`)} primary={primary} theme={theme} />
                    <ToggleRow label={t('fields.explicit_show')} value={showForm.explicit} onToggle={() => setShowForm((prev) => ({ ...prev, explicit: !prev.explicit }))} primary={primary} />
                    <TextArea label={t('fields.summary')} value={showForm.summary} onChangeText={(summary) => setShowForm((prev) => ({ ...prev, summary }))} style={{ color: theme.text }} />
                    <TextArea label={t('fields.description')} value={showForm.description} onChangeText={(description) => setShowForm((prev) => ({ ...prev, description }))} style={{ color: theme.text }} />
                    <HeroButton variant="primary" isDisabled={savingShow || !showForm.title.trim()} onPress={() => void handleCreateShow()}>
                      <HeroButton.Label>{t('studio.create_show')}</HeroButton.Label>
                    </HeroButton>
                  </HeroCard.Body>
                </HeroCard>
              ) : (
                <HeroCard className="mb-4 rounded-panel p-0">
                  <HeroCard.Body className="p-4">
                    <Text style={{ color: theme.warning }}>{t('studio.creation_unavailable')}</Text>
                  </HeroCard.Body>
                </HeroCard>
              )}

              <HeroCard className="mb-4 rounded-panel p-0">
                <HeroCard.Body className="gap-4 p-4">
                  <Text className="text-lg font-bold" style={{ color: theme.text }}>{t('studio.add_episode')}</Text>
                  {shows.length === 0 ? (
                    <Text style={{ color: theme.textSecondary }}>{t('studio.no_shows')}</Text>
                  ) : (
                    <OptionGroup
                      label={t('fields.show')}
                      values={shows.map((show) => String(show.id))}
                      selected={selectedShowId != null ? String(selectedShowId) : ''}
                      onSelect={(value) => setSelectedShowId(Number(value))}
                      labelFor={(value) => shows.find((show) => String(show.id) === value)?.title ?? value}
                      primary={primary}
                      theme={theme}
                    />
                  )}
                  <Input label={t('fields.episode_title')} maxLength={200} value={episodeForm.title} onChangeText={(title) => setEpisodeForm((prev) => ({ ...prev, title }))} style={{ color: theme.text }} />
                  {/*
                    Two ways to give an episode its audio, exactly as the web studio
                    offers: a file hosted by NEXUS, or an external URL. Choosing a
                    file disables the URL field rather than letting the two race —
                    the API prefers the URL when it receives both.
                  */}
                  <View className="gap-2">
                    <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('fields.audio_file')}</Text>
                    <HeroButton
                      variant="secondary"
                      testID="podcast-audio-file"
                      isDisabled={savingEpisode}
                      accessibilityLabel={t('fields.audio_file')}
                      onPress={() => void handlePickAudio()}
                    >
                      <Ionicons name="musical-notes-outline" size={16} color={primary} />
                      <HeroButton.Label>{t('fields.audio_file')}</HeroButton.Label>
                    </HeroButton>
                    <Text className="text-xs" style={{ color: theme.textSecondary }}>
                      {t('fields.audio_file_hint')} {t('studio.max_file_size', { max: uploadLimits.maxMb })}
                    </Text>
                    {audioFileError ? (
                      <Text className="text-xs" accessibilityRole="alert" style={{ color: theme.error }}>{audioFileError}</Text>
                    ) : null}
                    {audioFile ? (
                      <View className="flex-row items-center gap-2">
                        <Text className="min-w-0 flex-1 text-xs" numberOfLines={1} style={{ color: theme.textSecondary }}>
                          {audioFile.name}
                        </Text>
                        <HeroButton size="sm" variant="tertiary" isDisabled={savingEpisode} onPress={clearAudioFile}>
                          <HeroButton.Label>{t('fields.clear_audio_file')}</HeroButton.Label>
                        </HeroButton>
                      </View>
                    ) : null}
                  </View>
                  <Input
                    label={t('fields.audio_url')}
                    keyboardType="url"
                    autoCapitalize="none"
                    value={episodeForm.audioUrl}
                    onChangeText={(audioUrl) => setEpisodeForm((prev) => ({ ...prev, audioUrl }))}
                    editable={!savingEpisode && !audioFile}
                    style={{ color: theme.text }}
                  />
                  {audioFile ? (
                    <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('fields.audio_url_disabled_file_selected')}</Text>
                  ) : null}
                  {uploadProgress !== null ? (
                    <View className="gap-2">
                      <View className="flex-row items-center justify-between gap-2">
                        <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('studio.uploading')}</Text>
                        <Text className="text-xs" style={{ color: theme.textSecondary }}>{uploadProgress}%</Text>
                      </View>
                      <View
                        accessibilityRole="progressbar"
                        accessibilityLabel={t('studio.uploading')}
                        accessibilityValue={{ min: 0, max: 100, now: uploadProgress }}
                        className="h-2.5 overflow-hidden rounded-full bg-default-200"
                      >
                        <View className="h-2.5 rounded-full" style={{ width: `${uploadProgress}%`, backgroundColor: primary }} />
                      </View>
                      <HeroButton size="sm" variant="tertiary" onPress={handleCancelUpload}>
                        <HeroButton.Label>{t('studio.cancel_upload')}</HeroButton.Label>
                      </HeroButton>
                    </View>
                  ) : null}
                  <Input label={t('fields.episode_number')} keyboardType="number-pad" value={episodeForm.episodeNumber} onChangeText={(episodeNumber) => setEpisodeForm((prev) => ({ ...prev, episodeNumber }))} style={{ color: theme.text }} />
                  <Input label={t('fields.season_number')} keyboardType="number-pad" value={episodeForm.seasonNumber} onChangeText={(seasonNumber) => setEpisodeForm((prev) => ({ ...prev, seasonNumber }))} style={{ color: theme.text }} />
                  <ImageField label={t('fields.cover_image_file')} uri={episodeCoverUri} onPress={() => void pickImage(setEpisodeCoverUri)} theme={theme} />
                  <OptionGroup label={t('fields.visibility')} values={episodeVisibilityOptions} selected={episodeForm.visibility} onSelect={(visibility) => setEpisodeForm((prev) => ({ ...prev, visibility }))} labelFor={(value) => t(`visibility.${value}`)} primary={primary} theme={theme} />
                  <Input label={t('fields.duration_seconds')} keyboardType="number-pad" value={episodeForm.durationSeconds} onChangeText={(durationSeconds) => setEpisodeForm((prev) => ({ ...prev, durationSeconds }))} style={{ color: theme.text }} />
                  <Input
                    label={t('fields.scheduled_for')}
                    placeholder={t('fields.scheduled_for_hint')}
                    placeholderTextColor={theme.textMuted}
                    autoCapitalize="none"
                    value={episodeForm.scheduledFor}
                    onChangeText={(scheduledFor) => setEpisodeForm((prev) => ({ ...prev, scheduledFor }))}
                    style={{ color: theme.text }}
                  />
                  <OptionGroup label={t('fields.episode_type')} values={EPISODE_TYPES} selected={episodeForm.episodeType} onSelect={(episodeType) => setEpisodeForm((prev) => ({ ...prev, episodeType }))} labelFor={(value) => t(`episode.type.${value}`)} primary={primary} theme={theme} />
                  <TextArea label={t('fields.summary')} value={episodeForm.summary} onChangeText={(summary) => setEpisodeForm((prev) => ({ ...prev, summary }))} style={{ color: theme.text }} />
                  <TextArea label={t('fields.description')} value={episodeForm.description} onChangeText={(description) => setEpisodeForm((prev) => ({ ...prev, description }))} style={{ color: theme.text }} />
                  <ToggleRow label={t('fields.explicit_episode')} value={episodeForm.explicit} onToggle={() => setEpisodeForm((prev) => ({ ...prev, explicit: !prev.explicit }))} primary={primary} />
                  {capabilities.enable_transcripts !== false ? (
                    <>
                      <TextArea label={t('fields.transcript')} value={episodeForm.transcript} onChangeText={(transcript) => setEpisodeForm((prev) => ({ ...prev, transcript }))} style={{ color: theme.text }} />
                      <OptionGroup label={t('fields.transcript_language')} values={languages} selected={episodeForm.transcriptLanguage} onSelect={(transcriptLanguage) => setEpisodeForm((prev) => ({ ...prev, transcriptLanguage }))} labelFor={(value) => value.toUpperCase()} primary={primary} theme={theme} />
                    </>
                  ) : null}
                  {capabilities.enable_chapters !== false ? (
                    <>
                      <TextArea label={t('fields.chapters')} value={chaptersText} onChangeText={setChaptersText} style={{ color: theme.text }} />
                      <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('fields.chapters_hint')}</Text>
                      {chapterIssues > 0 ? (
                        <Text className="text-xs" style={{ color: theme.warning }}>{t('studio.chapter_format_warning', { count: chapterIssues })}</Text>
                      ) : null}
                    </>
                  ) : null}
                  {episodeError ? (
                    <Text style={{ color: theme.error }}>{episodeError}</Text>
                  ) : null}
                  <HeroButton variant="primary" isDisabled={savingEpisode || !canSubmitEpisode} onPress={() => void handleCreateEpisode()}>
                    <HeroButton.Label>{t('studio.add_episode')}</HeroButton.Label>
                  </HeroButton>
                </HeroCard.Body>
              </HeroCard>

              {selectedShow ? (
                <HeroCard className="mb-4 rounded-panel p-0">
                  <HeroCard.Body className="gap-3 p-4">
                    <Text className="text-lg font-bold" style={{ color: theme.text }}>{t('studio.readiness_title')}</Text>
                    <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('studio.readiness_subtitle', { title: selectedShow.title })}</Text>
                    {readinessChecks.map((check) => (
                      <View key={check.key} className="flex-row items-start gap-2">
                        <Ionicons
                          name={check.ok ? 'checkmark-circle-outline' : 'alert-circle-outline'}
                          size={16}
                          color={check.ok ? theme.success : theme.warning}
                        />
                        <Text className="min-w-0 flex-1 text-sm" style={{ color: check.ok ? theme.text : theme.textSecondary }}>
                          {t(`studio.readiness.${check.key}`)}
                        </Text>
                      </View>
                    ))}
                  </HeroCard.Body>
                </HeroCard>
              ) : null}

              {selectedShow ? <PodcastShowStatsPanel showId={selectedShow.id} /> : null}

              <Text className="mb-2 mt-2 text-lg font-bold" style={{ color: theme.text }}>{t('studio.my_shows')}</Text>
              {shows.length === 0 ? (
                <EmptyState icon="mic-outline" title={t('studio.no_shows')} />
              ) : (
                shows.map((show) => (
                  <HeroCard key={show.id} className="mb-3 rounded-panel p-0">
                    <HeroCard.Body className="gap-3 p-4">
                      <Text className="text-lg font-bold" style={{ color: theme.text }}>{show.title}</Text>
                      <Text style={{ color: theme.textSecondary }} numberOfLines={2}>{show.summary || t('show.no_summary')}</Text>
                      <View className="flex-row flex-wrap gap-2">
                        <Chip size="sm" variant="secondary"><Chip.Label>{t(`status.${show.status ?? 'draft'}`)}</Chip.Label></Chip>
                        <Chip size="sm" variant="secondary"><Chip.Label>{t(`moderation.${show.moderation_status ?? 'pending'}`)}</Chip.Label></Chip>
                      </View>
                      {show.moderation_feedback ? (
                        <Text className="text-sm" style={{ color: theme.warning }}>{t('studio.moderation_feedback', { feedback: show.moderation_feedback })}</Text>
                      ) : null}
                      <View className="gap-2">
                        <HeroButton variant="tertiary" onPress={() => setSelectedShowId(show.id)}>
                          <HeroButton.Label>{t('studio.select_show')}</HeroButton.Label>
                        </HeroButton>
                        <HeroButton variant="secondary" onPress={() => beginEditShow(show)}>
                          <HeroButton.Label>{t('studio.edit_show')}</HeroButton.Label>
                        </HeroButton>
                        {show.status === 'draft' ? (
                          <HeroButton variant="primary" onPress={() => void runShowAction(() => publishPodcastShow(show.id), 'studio.show_published')}>
                            <HeroButton.Label>{t('studio.publish_show')}</HeroButton.Label>
                          </HeroButton>
                        ) : null}
                        {show.status !== 'archived' ? (
                          <HeroButton variant="tertiary" onPress={() => handleArchiveShow(show)}>
                            <HeroButton.Label>{t('studio.archive_show')}</HeroButton.Label>
                          </HeroButton>
                        ) : null}
                        <HeroButton variant="tertiary" isDisabled={validatingShowId === show.id} onPress={() => void handleValidateFeed(show)}>
                          <HeroButton.Label>{t('studio.validate_feed')}</HeroButton.Label>
                        </HeroButton>
                        <HeroButton variant="danger" onPress={() => handleDeleteShow(show)}>
                          <HeroButton.Label>{t('studio.delete_show')}</HeroButton.Label>
                        </HeroButton>
                      </View>

                      {show.episodes && show.episodes.length > 0 ? (
                        <View className="gap-3 border-t pt-3" style={{ borderTopColor: theme.borderSubtle }}>
                          <Text className="text-sm font-bold" style={{ color: theme.text }}>{t('show.episodes')}</Text>
                          {show.episodes.map((episode) => (
                            <View key={episode.id} className="gap-2 rounded-panel-inner p-3" style={{ backgroundColor: withAlpha(primary, 0.06) }}>
                              <Text className="font-semibold" style={{ color: theme.text }} numberOfLines={2}>{episode.title}</Text>
                              <View className="flex-row flex-wrap gap-2">
                                <Chip size="sm" variant="secondary"><Chip.Label>{t(`status.${episode.status ?? 'draft'}`)}</Chip.Label></Chip>
                                {episode.scheduled_for && episode.status !== 'archived' ? (
                                  <Chip size="sm" variant="secondary">
                                    <Chip.Label>{t('studio.scheduled_for_chip', { date: formatScheduledDate(episode.scheduled_for) })}</Chip.Label>
                                  </Chip>
                                ) : null}
                                <Chip size="sm" variant="secondary"><Chip.Label>{t(`moderation.${episode.moderation_status ?? 'pending'}`)}</Chip.Label></Chip>
                                {episode.media_scan_status ? (
                                  <Chip size="sm" variant="secondary">
                                    <Chip.Label style={mediaToneStyle(mediaStatusTone(episode.media_scan_status), theme)}>
                                      {t('studio.media_scan_status', { status: t(`studio.media_status.${episode.media_scan_status}`, { defaultValue: episode.media_scan_status }) })}
                                    </Chip.Label>
                                  </Chip>
                                ) : null}
                                {episode.media_processing_status ? (
                                  <Chip size="sm" variant="secondary">
                                    <Chip.Label style={mediaToneStyle(mediaStatusTone(episode.media_processing_status), theme)}>
                                      {t('studio.media_processing_status', { status: t(`studio.media_status.${episode.media_processing_status}`, { defaultValue: episode.media_processing_status }) })}
                                    </Chip.Label>
                                  </Chip>
                                ) : null}
                              </View>
                              {episode.moderation_feedback ? (
                                <Text className="text-sm" style={{ color: theme.warning }}>{t('studio.moderation_feedback', { feedback: episode.moderation_feedback })}</Text>
                              ) : null}
                              <View className="gap-2">
                                <HeroButton variant="secondary" onPress={() => beginEditEpisode(show.id, episode)}>
                                  <HeroButton.Label>{t('studio.edit_episode')}</HeroButton.Label>
                                </HeroButton>
                                {episode.status === 'draft' ? (
                                  <HeroButton variant="primary" onPress={() => void runShowAction(() => publishPodcastEpisode(show.id, episode.id), 'studio.episode_published')}>
                                    <HeroButton.Label>{t('studio.publish_episode')}</HeroButton.Label>
                                  </HeroButton>
                                ) : null}
                                {episode.status !== 'archived' ? (
                                  <HeroButton variant="tertiary" onPress={() => handleArchiveEpisode(show.id, episode)}>
                                    <HeroButton.Label>{t('studio.archive_episode')}</HeroButton.Label>
                                  </HeroButton>
                                ) : null}
                                <HeroButton variant="danger" onPress={() => handleDeleteEpisode(show.id, episode)}>
                                  <HeroButton.Label>{t('studio.delete_episode')}</HeroButton.Label>
                                </HeroButton>
                              </View>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </HeroCard.Body>
                  </HeroCard>
                ))
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Edit forms are bottom sheets, not pushed screens: the web studio uses
          modals, both forms edit a row this screen already holds (a pushed
          screen would have to refetch it), and `app/_layout.tsx` — where a new
          route would have to be registered — is owned by another session. */}
      <BottomSheet visible={editingShow !== null} onClose={() => setEditingShow(null)} snapPoints={['80%', '94%']} title={t('studio.edit_show')}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
          <View className="gap-4 py-2">
            <Input label={t('fields.show_title')} maxLength={200} value={editingShowForm.title} onChangeText={(title) => setEditingShowForm((prev) => ({ ...prev, title }))} style={{ color: theme.text }} />
            <Input label={t('fields.category')} value={editingShowForm.category} onChangeText={(category) => setEditingShowForm((prev) => ({ ...prev, category }))} style={{ color: theme.text }} />
            <ImageField label={t('fields.artwork_file')} uri={editingShowArtworkUri} onPress={() => void pickImage(setEditingShowArtworkUri)} theme={theme} />
            <Input label={t('fields.author_name')} value={editingShowForm.authorName} onChangeText={(authorName) => setEditingShowForm((prev) => ({ ...prev, authorName }))} style={{ color: theme.text }} />
            <Input label={t('fields.owner_email')} keyboardType="email-address" autoCapitalize="none" value={editingShowForm.ownerEmail} onChangeText={(ownerEmail) => setEditingShowForm((prev) => ({ ...prev, ownerEmail }))} style={{ color: theme.text }} />
            <Input label={t('fields.copyright')} value={editingShowForm.copyright} onChangeText={(copyright) => setEditingShowForm((prev) => ({ ...prev, copyright }))} style={{ color: theme.text }} />
            <Input label={t('fields.funding_url')} keyboardType="url" autoCapitalize="none" value={editingShowForm.fundingUrl} onChangeText={(fundingUrl) => setEditingShowForm((prev) => ({ ...prev, fundingUrl }))} style={{ color: theme.text }} />
            <OptionGroup label={t('fields.language')} values={languages} selected={editingShowForm.language} onSelect={(language) => setEditingShowForm((prev) => ({ ...prev, language }))} labelFor={(value) => value.toUpperCase()} primary={primary} theme={theme} />
            <OptionGroup
              label={t('fields.visibility')}
              values={optionsWithCurrent(visibilityOptions, editingShow?.visibility)}
              selected={editingShowForm.visibility}
              onSelect={(visibility) => setEditingShowForm((prev) => ({ ...prev, visibility }))}
              labelFor={(value) => t(`visibility.${value}`)}
              primary={primary}
              theme={theme}
            />
            <ToggleRow label={t('fields.explicit_show')} value={editingShowForm.explicit} onToggle={() => setEditingShowForm((prev) => ({ ...prev, explicit: !prev.explicit }))} primary={primary} />
            <TextArea label={t('fields.summary')} value={editingShowForm.summary} onChangeText={(summary) => setEditingShowForm((prev) => ({ ...prev, summary }))} style={{ color: theme.text }} />
            <TextArea label={t('fields.description')} value={editingShowForm.description} onChangeText={(description) => setEditingShowForm((prev) => ({ ...prev, description }))} style={{ color: theme.text }} />
            <View className="flex-row gap-2">
              <HeroButton className="flex-1" variant="tertiary" onPress={() => setEditingShow(null)}>
                <HeroButton.Label>{t('actions.cancel')}</HeroButton.Label>
              </HeroButton>
              <HeroButton className="flex-[2]" variant="primary" isDisabled={savingEdit || !editingShowForm.title.trim()} onPress={() => void handleUpdateShow()}>
                <HeroButton.Label>{t('studio.save_changes')}</HeroButton.Label>
              </HeroButton>
            </View>
          </View>
        </ScrollView>
      </BottomSheet>

      <BottomSheet visible={editingEpisode !== null} onClose={() => setEditingEpisode(null)} snapPoints={['80%', '94%']} title={t('studio.edit_episode')}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
          <View className="gap-4 py-2">
            <Input label={t('fields.episode_title')} maxLength={200} value={editingEpisodeForm.title} onChangeText={(title) => setEditingEpisodeForm((prev) => ({ ...prev, title }))} style={{ color: theme.text }} />
            {!editingEpisode?.episode.hosted_audio ? (
              <Input label={t('fields.audio_url')} keyboardType="url" autoCapitalize="none" value={editingEpisodeForm.audioUrl} onChangeText={(audioUrl) => setEditingEpisodeForm((prev) => ({ ...prev, audioUrl }))} style={{ color: theme.text }} />
            ) : null}
            <Input label={t('fields.duration_seconds')} keyboardType="number-pad" value={editingEpisodeForm.durationSeconds} onChangeText={(durationSeconds) => setEditingEpisodeForm((prev) => ({ ...prev, durationSeconds }))} style={{ color: theme.text }} />
            <Input label={t('fields.episode_number')} keyboardType="number-pad" value={editingEpisodeForm.episodeNumber} onChangeText={(episodeNumber) => setEditingEpisodeForm((prev) => ({ ...prev, episodeNumber }))} style={{ color: theme.text }} />
            <Input label={t('fields.season_number')} keyboardType="number-pad" value={editingEpisodeForm.seasonNumber} onChangeText={(seasonNumber) => setEditingEpisodeForm((prev) => ({ ...prev, seasonNumber }))} style={{ color: theme.text }} />
            <ImageField label={t('fields.cover_image_file')} uri={editingEpisodeCoverUri} onPress={() => void pickImage(setEditingEpisodeCoverUri)} theme={theme} />
            <Input
              label={t('fields.scheduled_for')}
              placeholder={t('fields.scheduled_for_hint')}
              placeholderTextColor={theme.textMuted}
              autoCapitalize="none"
              value={editingEpisodeForm.scheduledFor}
              onChangeText={(scheduledFor) => setEditingEpisodeForm((prev) => ({ ...prev, scheduledFor }))}
              style={{ color: theme.text }}
            />
            <OptionGroup label={t('fields.episode_type')} values={EPISODE_TYPES} selected={editingEpisodeForm.episodeType} onSelect={(episodeType) => setEditingEpisodeForm((prev) => ({ ...prev, episodeType }))} labelFor={(value) => t(`episode.type.${value}`)} primary={primary} theme={theme} />
            <OptionGroup
              label={t('fields.visibility')}
              values={optionsWithCurrent(episodeVisibilityOptions, editingEpisode?.episode.visibility)}
              selected={editingEpisodeForm.visibility}
              onSelect={(visibility) => setEditingEpisodeForm((prev) => ({ ...prev, visibility }))}
              labelFor={(value) => t(`visibility.${value}`)}
              primary={primary}
              theme={theme}
            />
            <ToggleRow label={t('fields.explicit_episode')} value={editingEpisodeForm.explicit} onToggle={() => setEditingEpisodeForm((prev) => ({ ...prev, explicit: !prev.explicit }))} primary={primary} />
            <TextArea label={t('fields.summary')} value={editingEpisodeForm.summary} onChangeText={(summary) => setEditingEpisodeForm((prev) => ({ ...prev, summary }))} style={{ color: theme.text }} />
            <TextArea label={t('fields.description')} value={editingEpisodeForm.description} onChangeText={(description) => setEditingEpisodeForm((prev) => ({ ...prev, description }))} style={{ color: theme.text }} />
            {capabilities.enable_transcripts !== false ? (
              <>
                <TextArea label={t('fields.transcript')} value={editingEpisodeForm.transcript} onChangeText={(transcript) => setEditingEpisodeForm((prev) => ({ ...prev, transcript }))} style={{ color: theme.text }} />
                <OptionGroup label={t('fields.transcript_language')} values={languages} selected={editingEpisodeForm.transcriptLanguage} onSelect={(transcriptLanguage) => setEditingEpisodeForm((prev) => ({ ...prev, transcriptLanguage }))} labelFor={(value) => value.toUpperCase()} primary={primary} theme={theme} />
              </>
            ) : null}
            {capabilities.enable_chapters !== false ? (
              <>
                <TextArea label={t('fields.chapters')} value={editingChaptersText} onChangeText={setEditingChaptersText} style={{ color: theme.text }} />
                <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('fields.chapters_hint')}</Text>
              </>
            ) : null}
            <View className="flex-row gap-2">
              <HeroButton className="flex-1" variant="tertiary" onPress={() => setEditingEpisode(null)}>
                <HeroButton.Label>{t('actions.cancel')}</HeroButton.Label>
              </HeroButton>
              <HeroButton className="flex-[2]" variant="primary" isDisabled={savingEdit || !editingEpisodeForm.title.trim()} onPress={() => void handleUpdateEpisode()}>
                <HeroButton.Label>{t('studio.save_changes')}</HeroButton.Label>
              </HeroButton>
            </View>
          </View>
        </ScrollView>
      </BottomSheet>

      <BottomSheet
        visible={feedValidation !== null}
        onClose={() => setFeedValidation(null)}
        snapPoints={['60%', '88%']}
        title={feedValidation ? t('studio.feed_validation.title', { title: feedValidation.show.title }) : undefined}
      >
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
          <View className="gap-4 py-2">
            {feedValidation ? (
              <>
                <Text style={{ color: feedValidation.result.valid ? theme.success : theme.error }}>
                  {feedValidation.result.valid ? t('studio.feed_validation.valid') : t('studio.feed_validation.invalid')}
                </Text>

                {feedValidation.result.errors.length > 0 ? (
                  <View className="gap-1">
                    <Text className="font-bold" style={{ color: theme.error }}>{t('studio.feed_validation.errors')}</Text>
                    {feedValidation.result.errors.map((issue) => (
                      <Text key={issue} className="text-sm" style={{ color: theme.textSecondary }}>
                        {t(`studio.feed_validation.issues.${feedIssueKey(issue)}`, { defaultValue: issue })}
                      </Text>
                    ))}
                  </View>
                ) : null}

                {feedValidation.result.warnings.length > 0 ? (
                  <View className="gap-1">
                    <Text className="font-bold" style={{ color: theme.warning }}>{t('studio.feed_validation.warnings')}</Text>
                    {feedValidation.result.warnings.map((issue) => (
                      <Text key={issue} className="text-sm" style={{ color: theme.textSecondary }}>
                        {t(`studio.feed_validation.issues.${feedIssueKey(issue)}`, { defaultValue: issue })}
                      </Text>
                    ))}
                  </View>
                ) : null}

                {(feedValidation.result.skipped_episode_count ?? 0) > 0 ? (
                  <Text className="text-sm" style={{ color: theme.textSecondary }}>
                    {t('studio.feed_validation.skipped_episodes', { count: feedValidation.result.skipped_episode_count ?? 0 })}
                  </Text>
                ) : null}
              </>
            ) : null}
            <HeroButton variant="tertiary" onPress={() => setFeedValidation(null)}>
              <HeroButton.Label>{t('actions.close')}</HeroButton.Label>
            </HeroButton>
          </View>
        </ScrollView>
      </BottomSheet>

      {confirmDialog}
    </SafeAreaView>
  );
}

function ImageField({
  label,
  uri,
  onPress,
  theme,
}: {
  label: string;
  uri: string | null;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View className="gap-2">
      <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{label}</Text>
      <HeroButton variant="secondary" onPress={onPress}>
        <HeroButton.Label>{label}</HeroButton.Label>
      </HeroButton>
      {uri ? (
        <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>{uri.split('/').pop()}</Text>
      ) : null}
    </View>
  );
}

function ToggleRow({
  label,
  value,
  onToggle,
  primary,
}: {
  label: string;
  value: boolean;
  onToggle: () => void;
  primary: string;
}) {
  return (
    <HeroButton variant={value ? 'primary' : 'secondary'} onPress={onToggle}>
      <Ionicons name={value ? 'checkbox-outline' : 'square-outline'} size={15} color={value ? contrastText(primary) : primary} />
      <HeroButton.Label>{label}</HeroButton.Label>
    </HeroButton>
  );
}

function OptionGroup<T extends string>({
  label,
  values,
  selected,
  onSelect,
  labelFor,
  primary,
  theme,
}: {
  label: string;
  values: T[];
  selected: T | '';
  onSelect: (value: T) => void;
  labelFor: (value: T) => string;
  primary: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View className="gap-2">
      <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{label}</Text>
      <TagGroup
        size="sm"
        selectionMode="single"
        selectedKeys={selected ? [selected] : []}
        onSelectionChange={(keys) => {
          const next = Array.from(keys)[0];
          if (next !== undefined) onSelect(next as T);
        }}
      >
        <TagGroup.List>
          {values.map((value) => (
            <TagGroup.Item key={value} id={value}>
              <TagGroup.ItemLabel style={selected === value ? { color: contrastText(primary) } : undefined}>
                {labelFor(value)}
              </TagGroup.ItemLabel>
            </TagGroup.Item>
          ))}
        </TagGroup.List>
      </TagGroup>
    </View>
  );
}
