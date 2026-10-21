// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, Card, CardBody, Checkbox, Chip, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Progress, Select, SelectItem, Spinner, Textarea, useConfirm } from '@/components/ui';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import {
  podcastsApi,
  type CreatePodcastEpisodePayload,
  type CreatePodcastShowPayload,
  type PodcastChapter,
  type PodcastEpisode,
  type PodcastFeedValidation,
  type PodcastShow,
  type PodcastStudioCapabilities,
  type PodcastVisibility,
} from '@/lib/api/podcasts';
import { feedIssueKey } from '@/lib/podcasts/feedIssues';
import { PodcastShowStatsPanel } from '@/components/podcasts/PodcastShowStatsPanel';
import { PodcastStudioGuide } from '@/components/podcasts/PodcastStudioGuide';
import { PodcastShareLinks } from '@/components/podcasts/PodcastShareLinks';
import Archive from 'lucide-react/icons/archive';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import CalendarClock from 'lucide-react/icons/calendar-clock';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Megaphone from 'lucide-react/icons/megaphone';
import Plus from 'lucide-react/icons/plus';
import Radio from 'lucide-react/icons/radio';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Rss from 'lucide-react/icons/rss';
import Trash2 from 'lucide-react/icons/trash-2';
import XCircle from 'lucide-react/icons/circle-x';
import Pencil from 'lucide-react/icons/pencil';

/** Client-side fallback when /v2/podcasts/mine meta is unavailable. */
const DEFAULT_MAX_AUDIO_MB = 250;
const DEFAULT_AUDIO_MIMES = ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'video/webm'];

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

function mediaStatusColor(status?: string | null): 'success' | 'warning' | 'danger' | 'default' {
  if (!status || status === 'not_required') return 'default';
  if (status === 'complete' || status === 'clean') return 'success';
  if (status === 'failed' || status === 'blocked' || status === 'infected') return 'danger';
  return 'warning';
}

const emptyShow: CreatePodcastShowPayload = {
  title: '',
  summary: '',
  description: '',
  artwork_url: '',
  language: 'en',
  category: '',
  author_name: '',
  owner_email: '',
  copyright: '',
  funding_url: '',
  explicit: false,
  visibility: 'public',
};

const emptyEpisode: CreatePodcastEpisodePayload = {
  title: '',
  summary: '',
  description: '',
  audio_url: '',
  duration_seconds: undefined,
  episode_type: 'full',
  visibility: 'inherit',
  transcript: '',
};

function toApiDateTime(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
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

function toLocalDateTimeInput(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60_000));
  return local.toISOString().slice(0, 16);
}

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

type PendingImageUpload =
  | { kind: 'show'; showId: number; file: File }
  | { kind: 'episode'; showId: number; episodeId: number; file: File };

export default function PodcastStudioPage() {
  const { t } = useTranslation('podcasts');
  usePageTitle(t('studio.title'));
  const { tenantPath, supportedLanguages, defaultLanguage } = useTenant();
  const studioDefaultLanguage = defaultLanguage || 'en';
  const studioLanguages = supportedLanguages?.length ? supportedLanguages : [studioDefaultLanguage];
  const toast = useToast();
  const confirm = useConfirm();

  const [shows, setShows] = useState<PodcastShow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingShow, setSavingShow] = useState(false);
  const [savingEpisode, setSavingEpisode] = useState(false);
  const [selectedShowId, setSelectedShowId] = useState<string>('');
  const [showForm, setShowForm] = useState<CreatePodcastShowPayload>({ ...emptyShow, language: studioDefaultLanguage });
  const [episodeForm, setEpisodeForm] = useState<CreatePodcastEpisodePayload>({ ...emptyEpisode, transcript_language: studioDefaultLanguage });
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [showArtworkFile, setShowArtworkFile] = useState<File | null>(null);
  const [episodeCoverFile, setEpisodeCoverFile] = useState<File | null>(null);
  const [chaptersText, setChaptersText] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [episodeError, setEpisodeError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadLimits, setUploadLimits] = useState<{ maxMb: number; mimes: string[] }>({ maxMb: DEFAULT_MAX_AUDIO_MB, mimes: DEFAULT_AUDIO_MIMES });
  const [feedValidation, setFeedValidation] = useState<{ show: PodcastShow; result: PodcastFeedValidation } | null>(null);
  const [validatingShowId, setValidatingShowId] = useState<number | null>(null);
  const [capabilities, setCapabilities] = useState<PodcastStudioCapabilities>({
    allow_member_show_creation: true,
    can_create_show: true,
    enable_private_shows: true,
    enable_transcripts: true,
    enable_chapters: true,
    enable_episode_reactions: true,
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingShow, setEditingShow] = useState<PodcastShow | null>(null);
  const [editingShowForm, setEditingShowForm] = useState<CreatePodcastShowPayload>({ ...emptyShow });
  const [editingEpisode, setEditingEpisode] = useState<{ showId: number; episode: PodcastEpisode } | null>(null);
  const [editingEpisodeForm, setEditingEpisodeForm] = useState<Partial<CreatePodcastEpisodePayload>>({});
  const [editingChaptersText, setEditingChaptersText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editingShowArtworkFile, setEditingShowArtworkFile] = useState<File | null>(null);
  const [editingEpisodeCoverFile, setEditingEpisodeCoverFile] = useState<File | null>(null);
  const [pendingImageUpload, setPendingImageUpload] = useState<PendingImageUpload | null>(null);
  const [retryingImageUpload, setRetryingImageUpload] = useState(false);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  const chapterIssues = useMemo(() => countInvalidChapterLines(chaptersText), [chaptersText]);
  const canCreateShow = capabilities.can_create_show
    ?? (capabilities.allow_member_show_creation !== false
      && (!capabilities.max_shows_per_user || shows.length < capabilities.max_shows_per_user));

  const selectedShow = useMemo(
    () => shows.find((show) => String(show.id) === selectedShowId) ?? null,
    [shows, selectedShowId],
  );

  const readinessChecks = useMemo(() => {
    if (!selectedShow) return [];

    const hasPublishedEpisode = selectedShow.episodes?.some((episode) => episode.status === 'published' && episode.moderation_status === 'approved') ?? false;

    return [
      { key: 'public_show', ok: selectedShow.visibility === 'public' && selectedShow.status === 'published' && selectedShow.moderation_status === 'approved' },
      { key: 'owner_email', ok: Boolean(selectedShow.owner_email) },
      { key: 'description', ok: Boolean(selectedShow.description || selectedShow.summary) },
      { key: 'artwork', ok: Boolean(selectedShow.artwork_url) },
      { key: 'published_episode', ok: hasPublishedEpisode },
    ];
  }, [selectedShow]);

  const loadShows = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    const res = await podcastsApi.authored();
    if (res.success && res.data) {
      setShows(res.data);
      setSelectedShowId((current) => current || (res.data?.[0] ? String(res.data[0].id) : ''));
      // Upload constraints ride along in meta so files can be validated
      // before a multi-hundred-MB upload starts.
      const meta = res.meta as PodcastStudioCapabilities | undefined;
      if (meta) setCapabilities((current) => ({ ...current, ...meta }));
      if (meta?.max_audio_size_mb || meta?.allowed_audio_mimes) {
        setUploadLimits({
          maxMb: meta.max_audio_size_mb && meta.max_audio_size_mb > 0 ? meta.max_audio_size_mb : DEFAULT_MAX_AUDIO_MB,
          mimes: meta.allowed_audio_mimes?.length ? meta.allowed_audio_mimes : DEFAULT_AUDIO_MIMES,
        });
      }
    } else {
      setLoadError(res.error || t('studio.load_failed'));
    }
    setLoading(false);
  }, [t]);

  function handleAudioFileSelected(file: File | null): void {
    setFileError(null);
    if (!file) {
      setAudioFile(null);
      return;
    }

    if (uploadLimits.maxMb > 0 && file.size > uploadLimits.maxMb * 1024 * 1024) {
      setAudioFile(null);
      setFileError(t('studio.file_too_large', { max: uploadLimits.maxMb }));
      if (audioInputRef.current) audioInputRef.current.value = '';
      return;
    }

    // Only block types we know are unsupported — an empty/unknown MIME from
    // the browser passes through and lets the server content-check decide.
    if (file.type && !uploadLimits.mimes.includes(file.type)) {
      setAudioFile(null);
      setFileError(t('studio.unsupported_file_type'));
      if (audioInputRef.current) audioInputRef.current.value = '';
      return;
    }

    setAudioFile(file);
  }

  useEffect(() => {
    void loadShows();
    return () => uploadAbortRef.current?.abort();
  }, [loadShows]);

  async function handleCreateShow(): Promise<void> {
    if (!showForm.title.trim()) return;
    setSavingShow(true);
    const payload = { ...showForm };
    delete payload.artwork_url;
    const res = await podcastsApi.createShow({
      ...payload,
      title: showForm.title.trim(),
      visibility: (showForm.visibility ?? 'public') as PodcastVisibility,
    });
    setSavingShow(false);

    if (res.success && res.data) {
      if (showArtworkFile) {
        const upload = await podcastsApi.uploadShowArtwork(res.data.id, showArtworkFile);
        if (!upload.success) {
          setPendingImageUpload({ kind: 'show', showId: res.data.id, file: showArtworkFile });
          toast.warning(t('studio.artwork_upload_failed'));
        }
      }
      toast.success(t('studio.show_created'));
      setShowForm({ ...emptyShow, language: studioDefaultLanguage });
      setShowArtworkFile(null);
      await loadShows();
      setSelectedShowId(String(res.data.id));
    } else {
      toast.error(t('studio.save_failed'));
    }
  }

  async function handlePublishShow(show: PodcastShow): Promise<void> {
    const res = await podcastsApi.publishShow(show.id);
    if (res.success) {
      toast.success(t('studio.show_published'));
      await loadShows();
    } else {
      toast.error(res.error || t('studio.save_failed'));
    }
  }

  async function handlePublishEpisode(showId: number, episodeId: number): Promise<void> {
    const res = await podcastsApi.publishEpisode(showId, episodeId);
    if (res.success) {
      toast.success(t('studio.episode_published'));
      await loadShows();
    } else {
      // The server says why (e.g. the audio has not passed its virus scan yet);
      // "Could not save changes" told the creator nothing.
      toast.error(res.error || t('studio.save_failed'));
    }
  }

  async function handleArchiveShow(show: PodcastShow): Promise<void> {
    const ok = await confirm({
      title: t('studio.archive_show'),
      body: t('studio.confirm_archive_show', { title: show.title }),
      status: 'warning',
      confirmLabel: t('studio.archive_show'),
    });
    if (!ok) return;
    const res = await podcastsApi.archiveShow(show.id);
    if (res.success) {
      toast.success(t('studio.show_archived'));
      await loadShows();
    } else {
      toast.error(t('studio.save_failed'));
    }
  }

  async function handleDeleteShow(show: PodcastShow): Promise<void> {
    const ok = await confirm({
      title: t('studio.delete_show'),
      body: t('studio.confirm_delete_show', { title: show.title }),
      status: 'danger',
      confirmLabel: t('studio.delete_show'),
    });
    if (!ok) return;
    const res = await podcastsApi.deleteShow(show.id);
    if (res.success) {
      toast.success(t('studio.show_deleted'));
      setSelectedShowId((current) => current === String(show.id) ? '' : current);
      await loadShows();
    } else {
      toast.error(t('studio.save_failed'));
    }
  }

  async function handleArchiveEpisode(showId: number, episodeId: number, title: string): Promise<void> {
    const ok = await confirm({
      title: t('studio.archive_episode'),
      body: t('studio.confirm_archive_episode', { title }),
      status: 'warning',
      confirmLabel: t('studio.archive_episode'),
    });
    if (!ok) return;
    const res = await podcastsApi.archiveEpisode(showId, episodeId);
    if (res.success) {
      toast.success(t('studio.episode_archived'));
      await loadShows();
    } else {
      toast.error(t('studio.save_failed'));
    }
  }

  async function handleDeleteEpisode(showId: number, episodeId: number, title: string): Promise<void> {
    const ok = await confirm({
      title: t('studio.delete_episode'),
      body: t('studio.confirm_delete_episode', { title }),
      status: 'danger',
      confirmLabel: t('studio.delete_episode'),
    });
    if (!ok) return;
    const res = await podcastsApi.deleteEpisode(showId, episodeId);
    if (res.success) {
      toast.success(t('studio.episode_deleted'));
      await loadShows();
    } else {
      toast.error(t('studio.save_failed'));
    }
  }

  async function handleCreateEpisode(): Promise<void> {
    if (!selectedShow || !episodeForm.title.trim() || (!episodeForm.audio_url.trim() && !audioFile)) return;
    if (!audioFile && !isAllowedExternalAudioUrl(episodeForm.audio_url.trim())) {
      setEpisodeError(t('studio.audio_https_required'));
      return;
    }
    setSavingEpisode(true);
    setEpisodeError(null);
    const abortController = audioFile ? new AbortController() : null;
    uploadAbortRef.current = abortController;
    if (audioFile) setUploadProgress(0);
    const createPayload = { ...episodeForm };
    delete createPayload.cover_image_url;
    const res = await podcastsApi.createEpisode(
      selectedShow.id,
      {
        ...createPayload,
        title: episodeForm.title.trim(),
        // When a hosted file is present, omit audio_url so the upload path drives it.
        audio_url: audioFile ? '' : episodeForm.audio_url.trim(),
        audio_file: audioFile,
        scheduled_for: toApiDateTime(episodeForm.scheduled_for),
        ...(capabilities.enable_chapters !== false ? { chapters: parseChapters(chaptersText) } : {}),
        ...(capabilities.enable_transcripts === false ? { transcript: '', transcript_language: '' } : {}),
      },
      audioFile ? (percent) => setUploadProgress(percent) : undefined,
      abortController?.signal,
    );
    uploadAbortRef.current = null;
    setSavingEpisode(false);
    setUploadProgress(null);

    if (res.success) {
      if (episodeCoverFile && res.data) {
        const upload = await podcastsApi.uploadEpisodeCover(selectedShow.id, res.data.id, episodeCoverFile);
        if (!upload.success) {
          setPendingImageUpload({ kind: 'episode', showId: selectedShow.id, episodeId: res.data.id, file: episodeCoverFile });
          toast.warning(t('studio.cover_upload_failed'));
        }
      }
      toast.success(t('studio.episode_created'));
      setEpisodeForm({ ...emptyEpisode, transcript_language: studioDefaultLanguage });
      setAudioFile(null);
      setEpisodeCoverFile(null);
      setChaptersText('');
      if (audioInputRef.current) audioInputRef.current.value = '';
      await loadShows();
    } else if (res.code === 'UPLOAD_ABORTED') {
      // User-initiated cancel: keep the form and file intact for a retry.
      toast.info(t('studio.upload_cancelled'));
    } else {
      // The API returns a specific reason (unsupported type, too large, upload
      // failed, invalid URL) — surface it instead of a generic save error.
      const message = res.error ?? t('studio.save_failed');
      setEpisodeError(message);
      toast.error(message);
    }
  }

  function handleCancelUpload(): void {
    uploadAbortRef.current?.abort();
  }

  async function handleValidateFeed(show: PodcastShow): Promise<void> {
    setValidatingShowId(show.id);
    const res = await podcastsApi.validateShowFeed(show.id);
    setValidatingShowId(null);
    if (res.success && res.data) {
      setFeedValidation({ show, result: res.data });
    } else {
      toast.error(t('studio.save_failed'));
    }
  }

  function formatScheduledDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString(getFormattingLocale());
  }

  function clearAudioFile(): void {
    setAudioFile(null);
    if (audioInputRef.current) {
      audioInputRef.current.value = '';
    }
  }

  function beginEditShow(show: PodcastShow): void {
    setEditingShowArtworkFile(null);
    setEditingShow(show);
    setEditingShowForm({
      title: show.title,
      summary: show.summary ?? '',
      description: show.description ?? '',
      artwork_url: show.artwork_url ?? '',
      language: show.language || studioDefaultLanguage,
      category: show.category ?? '',
      author_name: show.author_name ?? '',
      owner_email: show.owner_email ?? '',
      copyright: show.copyright ?? '',
      funding_url: show.funding_url ?? '',
      explicit: show.explicit ?? false,
      visibility: show.visibility,
    });
  }

  async function handleUpdateShow(): Promise<void> {
    if (!editingShow || !editingShowForm.title.trim()) return;
    setSavingEdit(true);
    const payload = { ...editingShowForm };
    delete payload.artwork_url;
    if (capabilities.enable_private_shows === false
      && isRestrictedVisibility(editingShow.visibility)
      && payload.visibility === editingShow.visibility) {
      delete payload.visibility;
    }
    const res = await podcastsApi.updateShow(editingShow.id, {
      ...payload,
      title: editingShowForm.title.trim(),
    });
    setSavingEdit(false);
    if (res.success) {
      if (editingShowArtworkFile) {
        const upload = await podcastsApi.uploadShowArtwork(editingShow.id, editingShowArtworkFile);
        if (!upload.success) {
          setPendingImageUpload({ kind: 'show', showId: editingShow.id, file: editingShowArtworkFile });
          toast.warning(t('studio.artwork_upload_failed'));
        }
      }
      toast.success(t('studio.show_updated'));
      setEditingShow(null);
      await loadShows();
    } else {
      toast.error(res.error || t('studio.save_failed'));
    }
  }

  function beginEditEpisode(showId: number, episode: PodcastEpisode): void {
    setEditingEpisodeCoverFile(null);
    setEditingEpisode({ showId, episode });
    setEditingEpisodeForm({
      title: episode.title,
      summary: episode.summary ?? '',
      description: episode.description ?? '',
      duration_seconds: episode.duration_seconds ?? undefined,
      episode_number: episode.episode_number ?? undefined,
      season_number: episode.season_number ?? undefined,
      explicit: episode.explicit,
      episode_type: episode.episode_type,
      visibility: episode.visibility,
      transcript: episode.transcript ?? '',
      transcript_language: episode.transcript_language ?? '',
      cover_image_url: episode.cover_image_url ?? '',
      scheduled_for: toLocalDateTimeInput(episode.scheduled_for),
      ...(!episode.hosted_audio ? { audio_url: episode.audio_url } : {}),
    });
    setEditingChaptersText((episode.chapters ?? [])
      .map((chapter) => `${formatChapterTime(chapter.starts_at_seconds)} ${chapter.title}`)
      .join('\n'));
  }

  async function handleUpdateEpisode(): Promise<void> {
    if (!editingEpisode || !editingEpisodeForm.title?.trim()) return;
    if (editingEpisodeForm.audio_url && !isAllowedExternalAudioUrl(editingEpisodeForm.audio_url.trim())) {
      toast.error(t('studio.audio_https_required'));
      return;
    }
    setSavingEdit(true);
    const payload: Partial<CreatePodcastEpisodePayload> = {
      ...editingEpisodeForm,
      title: editingEpisodeForm.title.trim(),
      scheduled_for: toApiDateTime(editingEpisodeForm.scheduled_for),
      ...(capabilities.enable_chapters !== false ? { chapters: parseChapters(editingChaptersText) } : {}),
    };
    if (editingEpisode.episode.hosted_audio) delete payload.audio_url;
    delete payload.cover_image_url;
    if (capabilities.enable_private_shows === false
      && isRestrictedVisibility(editingEpisode.episode.visibility)
      && payload.visibility === editingEpisode.episode.visibility) {
      delete payload.visibility;
    }
    const res = await podcastsApi.updateEpisode(editingEpisode.showId, editingEpisode.episode.id, payload);
    setSavingEdit(false);
    if (res.success) {
      if (editingEpisodeCoverFile) {
        const upload = await podcastsApi.uploadEpisodeCover(editingEpisode.showId, editingEpisode.episode.id, editingEpisodeCoverFile);
        if (!upload.success) {
          setPendingImageUpload({
            kind: 'episode',
            showId: editingEpisode.showId,
            episodeId: editingEpisode.episode.id,
            file: editingEpisodeCoverFile,
          });
          toast.warning(t('studio.cover_upload_failed'));
        }
      }
      toast.success(t('studio.episode_updated'));
      setEditingEpisode(null);
      await loadShows();
    } else {
      toast.error(res.error || t('studio.save_failed'));
    }
  }

  async function handleRetryImageUpload(): Promise<void> {
    if (!pendingImageUpload) return;
    setRetryingImageUpload(true);
    const res = pendingImageUpload.kind === 'show'
      ? await podcastsApi.uploadShowArtwork(pendingImageUpload.showId, pendingImageUpload.file)
      : await podcastsApi.uploadEpisodeCover(
        pendingImageUpload.showId,
        pendingImageUpload.episodeId,
        pendingImageUpload.file,
      );
    setRetryingImageUpload(false);
    if (res.success) {
      setPendingImageUpload(null);
      toast.success(pendingImageUpload.kind === 'show' ? t('studio.show_updated') : t('studio.episode_updated'));
      await loadShows();
    } else {
      toast.warning(pendingImageUpload.kind === 'show'
        ? t('studio.artwork_upload_failed')
        : t('studio.cover_upload_failed'));
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <Button as={Link} to={tenantPath('/podcasts')} variant="tertiary" size="sm" startContent={<ArrowLeft className="rtl:rotate-180" size={16} aria-hidden="true" />}>
        {t('actions.back_to_podcasts')}
      </Button>

      <div className="mt-5 mb-6">
        <h1 className="text-2xl font-bold leading-tight">{t('studio.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t('studio.subtitle')}</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16" role="status" aria-busy="true">
          <Spinner size="lg" />
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-8 text-center" role="alert">
          <XCircle className="mx-auto mb-3 text-danger" size={32} aria-hidden="true" />
          <p className="font-semibold text-foreground">{t('studio.load_failed')}</p>
          <p className="mt-1 text-sm text-muted">{loadError}</p>
          <Button className="mt-4" variant="secondary" startContent={<RefreshCw size={14} aria-hidden="true" />} onPress={loadShows}>
            {t('studio.retry_load')}
          </Button>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]">
          <section className="space-y-4">
            {pendingImageUpload && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning" role="alert">
                <span className="min-w-0 flex-1">
                  {pendingImageUpload.kind === 'show'
                    ? t('studio.artwork_upload_failed')
                    : t('studio.cover_upload_failed')}
                </span>
                <Button size="sm" variant="secondary" isLoading={retryingImageUpload} onPress={handleRetryImageUpload}>
                  {t('studio.retry_upload')}
                </Button>
              </div>
            )}

            <PodcastStudioGuide
              maxAudioMb={uploadLimits.maxMb}
              expandAll={shows.length === 0}
              rssEnabled={capabilities.enable_rss_feed !== false}
            />

            {canCreateShow ? (
              <Card>
                <CardBody className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Plus size={18} className="text-accent" aria-hidden="true" />
                    <h2 className="text-lg font-semibold">{t('studio.create_show')}</h2>
                  </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label={t('fields.show_title')} maxLength={200} value={showForm.title} onValueChange={(title) => setShowForm((prev) => ({ ...prev, title }))} />
                  <Input label={t('fields.category')} value={showForm.category ?? ''} onValueChange={(category) => setShowForm((prev) => ({ ...prev, category }))} />
                  <label className="block text-sm font-medium text-foreground">
                    {t('fields.artwork_file')}
                    <input className="mt-1 block w-full text-sm" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setShowArtworkFile(event.currentTarget.files?.[0] ?? null)} />
                    {showArtworkFile && <span className="mt-1 block text-xs text-muted">{showArtworkFile.name}</span>}
                  </label>
                  <Input label={t('fields.author_name')} value={showForm.author_name ?? ''} onValueChange={(author_name) => setShowForm((prev) => ({ ...prev, author_name }))} />
                  <Input label={t('fields.owner_email')} type="email" value={showForm.owner_email ?? ''} onValueChange={(owner_email) => setShowForm((prev) => ({ ...prev, owner_email }))} />
                  <Input label={t('fields.copyright')} value={showForm.copyright ?? ''} onValueChange={(copyright) => setShowForm((prev) => ({ ...prev, copyright }))} />
                  <Input label={t('fields.funding_url')} value={showForm.funding_url ?? ''} onValueChange={(funding_url) => setShowForm((prev) => ({ ...prev, funding_url }))} />
                  <Select
                    label={t('fields.language')}
                    selectedKeys={[showForm.language || studioDefaultLanguage]}
                    onSelectionChange={(keys) => setShowForm((prev) => ({ ...prev, language: String(Array.from(keys)[0] ?? studioDefaultLanguage) }))}
                  >
                    {studioLanguages.map((language) => (
                      <SelectItem key={language} id={language}>{language.toUpperCase()}</SelectItem>
                    ))}
                  </Select>
                  <Select
                    label={t('fields.visibility')}
                    selectedKeys={[showForm.visibility ?? 'public']}
                    onSelectionChange={(keys) => setShowForm((prev) => ({ ...prev, visibility: (Array.from(keys)[0] as PodcastVisibility) ?? 'public' }))}
                  >
                    <SelectItem id="public">{t('visibility.public')}</SelectItem>
                    {capabilities.enable_private_shows !== false && <SelectItem id="members">{t('visibility.members')}</SelectItem>}
                    {capabilities.enable_private_shows !== false && <SelectItem id="private">{t('visibility.private')}</SelectItem>}
                  </Select>
                </div>
                <Checkbox isSelected={Boolean(showForm.explicit)} onValueChange={(explicit) => setShowForm((prev) => ({ ...prev, explicit }))}>
                  {t('fields.explicit_show')}
                </Checkbox>
                <Textarea label={t('fields.summary')} value={showForm.summary ?? ''} onValueChange={(summary) => setShowForm((prev) => ({ ...prev, summary }))} />
                <Textarea label={t('fields.description')} value={showForm.description ?? ''} onValueChange={(description) => setShowForm((prev) => ({ ...prev, description }))} />
                <div className="flex justify-end">
                  <Button color="primary" isLoading={savingShow} isDisabled={!showForm.title.trim()} onPress={handleCreateShow}>
                    {t('studio.create_show')}
                  </Button>
                </div>
              </CardBody>
              </Card>
            ) : (
              <p className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning" role="status">
                {t('studio.creation_unavailable')}
              </p>
            )}

            <Card>
              <CardBody className="space-y-4">
                <div className="flex items-center gap-2">
                  <Radio size={18} className="text-accent" aria-hidden="true" />
                  <h2 className="text-lg font-semibold">{t('studio.add_episode')}</h2>
                </div>
                <Select
                  label={t('fields.show')}
                  selectedKeys={selectedShowId ? [selectedShowId] : []}
                  onSelectionChange={(keys) => setSelectedShowId((Array.from(keys)[0] as string) ?? '')}
                >
                  {shows.map((show) => (
                    <SelectItem key={show.id} id={String(show.id)}>{show.title}</SelectItem>
                  ))}
                </Select>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label={t('fields.episode_title')} maxLength={200} value={episodeForm.title} onValueChange={(title) => setEpisodeForm((prev) => ({ ...prev, title }))} />
                  <Input
                    label={t('fields.audio_url')}
                    type="url"
                    value={episodeForm.audio_url}
                    onValueChange={(audio_url) => setEpisodeForm((prev) => ({ ...prev, audio_url }))}
                    isDisabled={Boolean(audioFile) || savingEpisode}
                    description={audioFile ? t('fields.audio_url_disabled_file_selected') : t('fields.audio_url_hint')}
                  />
                  <Input
                    label={t('fields.episode_number')}
                    type="number"
                    min="0"
                    value={episodeForm.episode_number != null ? String(episodeForm.episode_number) : ''}
                    onValueChange={(value) => setEpisodeForm((prev) => ({ ...prev, episode_number: value ? Math.max(0, Number(value)) : undefined }))}
                  />
                  <Input
                    label={t('fields.season_number')}
                    type="number"
                    min="0"
                    value={episodeForm.season_number != null ? String(episodeForm.season_number) : ''}
                    onValueChange={(value) => setEpisodeForm((prev) => ({ ...prev, season_number: value ? Math.max(0, Number(value)) : undefined }))}
                  />
                  <label className="block text-sm font-medium text-foreground">
                    {t('fields.cover_image_file')}
                    <input className="mt-1 block w-full text-sm" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setEpisodeCoverFile(event.currentTarget.files?.[0] ?? null)} />
                    {episodeCoverFile && <span className="mt-1 block text-xs text-muted">{episodeCoverFile.name}</span>}
                  </label>
                  <Select
                    label={t('fields.visibility')}
                    selectedKeys={[episodeForm.visibility ?? 'inherit']}
                    onSelectionChange={(keys) => setEpisodeForm((prev) => ({ ...prev, visibility: (Array.from(keys)[0] as CreatePodcastEpisodePayload['visibility']) ?? 'inherit' }))}
                  >
                    <SelectItem id="inherit">{t('visibility.inherit')}</SelectItem>
                    <SelectItem id="public">{t('visibility.public')}</SelectItem>
                    {capabilities.enable_private_shows !== false && <SelectItem id="members">{t('visibility.members')}</SelectItem>}
                    {capabilities.enable_private_shows !== false && <SelectItem id="private">{t('visibility.private')}</SelectItem>}
                  </Select>
                  <div className="sm:col-span-2">
                    <label htmlFor="podcast-audio-file" className="block text-sm font-medium text-foreground">
                      {t('fields.audio_file')}
                    </label>
                    <input
                      ref={audioInputRef}
                      id="podcast-audio-file"
                      className="mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-surface-secondary file:px-3 file:py-1 file:text-sm file:font-medium file:text-foreground"
                      type="file"
                      accept="audio/*,.mp3,.m4a,.wav,.ogg,.webm"
                      aria-describedby={fileError ? 'podcast-audio-file-error' : 'podcast-audio-file-hint'}
                      aria-invalid={Boolean(fileError)}
                      disabled={savingEpisode}
                      onChange={(event) => handleAudioFileSelected(event.currentTarget.files?.[0] ?? null)}
                    />
                    <p id="podcast-audio-file-hint" className="mt-1 text-xs text-muted">
                      {t('fields.audio_file_hint')} {t('studio.max_file_size', { max: uploadLimits.maxMb })}
                    </p>
                    {fileError && (
                      <p id="podcast-audio-file-error" className="mt-1 text-xs text-danger" role="alert">{fileError}</p>
                    )}
                    {audioFile && (
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-secondary/70 px-3 py-2 text-xs text-muted">
                        <span className="min-w-0 truncate">{audioFile.name}</span>
                        <Button
                          size="sm"
                          variant="tertiary"
                          startContent={<XCircle size={14} aria-hidden="true" />}
                          onPress={clearAudioFile}
                          isDisabled={savingEpisode}
                        >
                          {t('fields.clear_audio_file')}
                        </Button>
                      </div>
                    )}
                  </div>
                  <Input
                    label={t('fields.duration_seconds')}
                    type="number"
                    value={episodeForm.duration_seconds ? String(episodeForm.duration_seconds) : ''}
                    onValueChange={(value) => setEpisodeForm((prev) => {
                      const parsed = Number(value);
                      return { ...prev, duration_seconds: value && Number.isFinite(parsed) ? parsed : undefined };
                    })}
                  />
                  <Input
                    label={t('fields.scheduled_for')}
                    type="datetime-local"
                    value={episodeForm.scheduled_for ?? ''}
                    onValueChange={(scheduled_for) => setEpisodeForm((prev) => ({ ...prev, scheduled_for: scheduled_for || undefined }))}
                  />
                  <Select
                    label={t('fields.episode_type')}
                    selectedKeys={[episodeForm.episode_type ?? 'full']}
                    onSelectionChange={(keys) => setEpisodeForm((prev) => ({ ...prev, episode_type: (Array.from(keys)[0] as CreatePodcastEpisodePayload['episode_type']) ?? 'full' }))}
                  >
                    <SelectItem id="full">{t('episode.type.full')}</SelectItem>
                    <SelectItem id="trailer">{t('episode.type.trailer')}</SelectItem>
                    <SelectItem id="bonus">{t('episode.type.bonus')}</SelectItem>
                  </Select>
                </div>
                <Textarea label={t('fields.summary')} value={episodeForm.summary ?? ''} onValueChange={(summary) => setEpisodeForm((prev) => ({ ...prev, summary }))} />
                <Textarea label={t('fields.description')} value={episodeForm.description ?? ''} onValueChange={(description) => setEpisodeForm((prev) => ({ ...prev, description }))} />
                <Checkbox isSelected={Boolean(episodeForm.explicit)} onValueChange={(explicit) => setEpisodeForm((prev) => ({ ...prev, explicit }))}>
                  {t('fields.explicit_episode')}
                </Checkbox>
                {capabilities.enable_transcripts !== false && (
                  <>
                    <Textarea label={t('fields.transcript')} value={episodeForm.transcript ?? ''} onValueChange={(transcript) => setEpisodeForm((prev) => ({ ...prev, transcript }))} />
                    <Select
                      label={t('fields.transcript_language')}
                      selectedKeys={[episodeForm.transcript_language || studioDefaultLanguage]}
                      onSelectionChange={(keys) => setEpisodeForm((prev) => ({ ...prev, transcript_language: String(Array.from(keys)[0] ?? studioDefaultLanguage) }))}
                    >
                      {studioLanguages.map((language) => (
                        <SelectItem key={language} id={language}>{language.toUpperCase()}</SelectItem>
                      ))}
                    </Select>
                  </>
                )}
                {capabilities.enable_chapters !== false && (
                  <Textarea label={t('fields.chapters')} description={t('fields.chapters_hint')} value={chaptersText} onValueChange={setChaptersText} />
                )}
                {capabilities.enable_chapters !== false && chapterIssues > 0 && (
                  <p className="text-xs text-warning">{t('studio.chapter_format_warning', { count: chapterIssues })}</p>
                )}
                {uploadProgress !== null && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted">
                      <span>{t('studio.uploading')}</span>
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums">{uploadProgress}%</span>
                        <Button size="sm" variant="tertiary" onPress={handleCancelUpload}>
                          {t('studio.cancel_upload')}
                        </Button>
                      </div>
                    </div>
                    <Progress aria-label={t('studio.uploading')} value={uploadProgress} />
                  </div>
                )}
                {episodeError && (
                  <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                    <XCircle size={16} aria-hidden="true" />
                    <span className="min-w-0 flex-1">{episodeError}</span>
                    <Button
                      size="sm"
                      variant="tertiary"
                      startContent={<RefreshCw size={14} aria-hidden="true" />}
                      onPress={handleCreateEpisode}
                      isDisabled={savingEpisode}
                    >
                      {t('studio.retry_upload')}
                    </Button>
                  </div>
                )}
                <div className="flex justify-end">
                  <Button color="primary" isLoading={savingEpisode} isDisabled={!selectedShow || !episodeForm.title.trim() || (!episodeForm.audio_url.trim() && !audioFile)} onPress={handleCreateEpisode}>
                    {t('studio.add_episode')}
                  </Button>
                </div>
              </CardBody>
            </Card>
          </section>

          <aside className="space-y-3">
            {selectedShow && (
              <Card>
                <CardBody className="space-y-3">
                  <div>
                    <h2 className="text-lg font-semibold">{t('studio.readiness_title')}</h2>
                    <p className="mt-1 text-sm text-muted">{t('studio.readiness_subtitle', { title: selectedShow.title })}</p>
                  </div>
                  <div className="space-y-2">
                    {readinessChecks.map((check) => {
                      const Icon = check.ok ? CheckCircle : XCircle;
                      return (
                        <div key={check.key} className="flex items-start gap-2 text-sm">
                          <Icon size={16} className={check.ok ? 'mt-0.5 text-success' : 'mt-0.5 text-warning'} aria-hidden="true" />
                          <span className={check.ok ? 'text-foreground' : 'text-muted'}>
                            {t(`studio.readiness.${check.key}`)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </CardBody>
              </Card>
            )}

            {selectedShow && <PodcastShowStatsPanel showId={selectedShow.id} />}

            <div className="flex items-center gap-2">
              <Megaphone size={18} className="text-accent" aria-hidden="true" />
              <h2 className="text-lg font-semibold">{t('studio.my_shows')}</h2>
            </div>
            {shows.length === 0 ? (
              <div className="rounded-lg border border-border bg-surface-secondary/60 px-4 py-8 text-center text-sm text-muted">
                {t('studio.no_shows')}
              </div>
            ) : (
              shows.map((show) => (
                <Card key={show.id}>
                  <CardBody className="space-y-3">
                    <div>
                      <Link className="font-semibold hover:text-accent" to={tenantPath(`/podcasts/${show.slug}`)}>
                        {show.title}
                      </Link>
                      <p className="mt-1 line-clamp-2 text-sm text-muted">{show.summary || t('show.no_summary')}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="tertiary" startContent={<Pencil size={14} aria-hidden="true" />} onPress={() => beginEditShow(show)}>
                        {t('studio.edit_show')}
                      </Button>
                      <Chip size="sm" variant="soft">{t(`status.${show.status}`)}</Chip>
                      <Chip size="sm" variant="soft" color={show.moderation_status === 'approved' ? 'success' : 'warning'}>
                        {t(`moderation.${show.moderation_status}`)}
                      </Chip>
                    </div>
                    {show.moderation_feedback && (
                      <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
                        {t('studio.moderation_feedback', { feedback: show.moderation_feedback })}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="tertiary" onPress={() => setSelectedShowId(String(show.id))}>
                        {t('studio.select_show')}
                      </Button>
                      {show.status === 'draft' && (
                        <Button size="sm" color="primary" onPress={() => handlePublishShow(show)}>
                          {t('studio.publish_show')}
                        </Button>
                      )}
                      {show.status !== 'archived' && (
                        <Button size="sm" variant="tertiary" startContent={<Archive size={14} aria-hidden="true" />} onPress={() => handleArchiveShow(show)}>
                          {t('studio.archive_show')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="tertiary"
                        startContent={<Rss size={14} aria-hidden="true" />}
                        onPress={() => handleValidateFeed(show)}
                        isLoading={validatingShowId === show.id}
                      >
                        {t('studio.validate_feed')}
                      </Button>
                      <Button size="sm" variant="tertiary" color="danger" startContent={<Trash2 size={14} aria-hidden="true" />} onPress={() => handleDeleteShow(show)}>
                        {t('studio.delete_show')}
                      </Button>
                    </div>
                    <PodcastShareLinks show={show} rssEnabled={capabilities.enable_rss_feed !== false} />
                    {show.episodes && show.episodes.length > 0 && (
                      <div className="space-y-2 border-t border-border pt-3">
                        <h3 className="text-sm font-semibold">{t('show.episodes')}</h3>
                        {show.episodes.map((episode) => (
                          <div key={episode.id} className="flex flex-col gap-2 rounded-md bg-surface-secondary/60 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{episode.title}</p>
                              <div className="mt-1 flex flex-wrap gap-1">
                                <Chip size="sm" variant="soft">{t(`status.${episode.status}`)}</Chip>
                                {episode.scheduled_for && episode.status !== 'archived' && (
                                  <Chip size="sm" variant="soft" color="primary" startContent={<CalendarClock size={12} aria-hidden="true" />}>
                                    {t('studio.scheduled_for_chip', { date: formatScheduledDate(episode.scheduled_for) })}
                                  </Chip>
                                )}
                                <Chip size="sm" variant="soft" color={episode.moderation_status === 'approved' ? 'success' : 'warning'}>
                                  {t(`moderation.${episode.moderation_status}`)}
                                </Chip>
                                {(['media_scan_status', 'media_processing_status'] as const).map((field) => {
                                  const status = episode[field as keyof PodcastEpisode] as string | null | undefined;
                                  if (!status) return null;

                                  return (
                                    <Chip key={field} size="sm" variant="soft" color={mediaStatusColor(status)}>
                                      {t(`studio.${field}`, { status: t(`studio.media_status.${status}`, { defaultValue: status }) })}
                                    </Chip>
                                  );
                                })}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" variant="tertiary" startContent={<Pencil size={14} aria-hidden="true" />} onPress={() => beginEditEpisode(show.id, episode)}>
                                {t('studio.edit_episode')}
                              </Button>
                              {episode.status === 'draft' && (
                                <Button size="sm" color="primary" onPress={() => handlePublishEpisode(show.id, episode.id)}>
                                  {t('studio.publish_episode')}
                                </Button>
                              )}
                              {episode.status !== 'archived' && (
                                <Button size="sm" variant="tertiary" startContent={<Archive size={14} aria-hidden="true" />} onPress={() => handleArchiveEpisode(show.id, episode.id, episode.title)}>
                                  {t('studio.archive_episode')}
                                </Button>
                              )}
                              <Button size="sm" variant="tertiary" color="danger" startContent={<Trash2 size={14} aria-hidden="true" />} onPress={() => handleDeleteEpisode(show.id, episode.id, episode.title)}>
                                {t('studio.delete_episode')}
                              </Button>
                            </div>
                            {episode.moderation_feedback && (
                              <p className="text-sm text-warning sm:basis-full">
                                {t('studio.moderation_feedback', { feedback: episode.moderation_feedback })}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardBody>
                </Card>
              ))
            )}
          </aside>
        </div>
      )}

      <Modal isOpen={editingShow !== null} onClose={() => setEditingShow(null)} size="2xl">
        <ModalContent>
          <ModalHeader>{t('studio.edit_show')}</ModalHeader>
          <ModalBody className="gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={t('fields.show_title')} maxLength={200} value={editingShowForm.title} onValueChange={(title) => setEditingShowForm((prev) => ({ ...prev, title }))} />
              <Input label={t('fields.category')} value={editingShowForm.category ?? ''} onValueChange={(category) => setEditingShowForm((prev) => ({ ...prev, category }))} />
              <label className="block text-sm font-medium text-foreground">
                {t('fields.artwork_file')}
                <input className="mt-1 block w-full text-sm" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setEditingShowArtworkFile(event.currentTarget.files?.[0] ?? null)} />
                {editingShowArtworkFile && <span className="mt-1 block text-xs text-muted">{editingShowArtworkFile.name}</span>}
              </label>
              <Input label={t('fields.author_name')} value={editingShowForm.author_name ?? ''} onValueChange={(author_name) => setEditingShowForm((prev) => ({ ...prev, author_name }))} />
              <Input label={t('fields.owner_email')} type="email" value={editingShowForm.owner_email ?? ''} onValueChange={(owner_email) => setEditingShowForm((prev) => ({ ...prev, owner_email }))} />
              <Input label={t('fields.copyright')} value={editingShowForm.copyright ?? ''} onValueChange={(copyright) => setEditingShowForm((prev) => ({ ...prev, copyright }))} />
              <Input label={t('fields.funding_url')} value={editingShowForm.funding_url ?? ''} onValueChange={(funding_url) => setEditingShowForm((prev) => ({ ...prev, funding_url }))} />
              <Select
                label={t('fields.language')}
                selectedKeys={[editingShowForm.language || studioDefaultLanguage]}
                onSelectionChange={(keys) => setEditingShowForm((prev) => ({ ...prev, language: String(Array.from(keys)[0] ?? studioDefaultLanguage) }))}
              >
                {studioLanguages.map((language) => (
                  <SelectItem key={language} id={language}>{language.toUpperCase()}</SelectItem>
                ))}
              </Select>
              <Select
                label={t('fields.visibility')}
                selectedKeys={[editingShowForm.visibility ?? 'public']}
                onSelectionChange={(keys) => setEditingShowForm((prev) => ({ ...prev, visibility: (Array.from(keys)[0] as PodcastVisibility) ?? 'public' }))}
              >
                <SelectItem id="public">{t('visibility.public')}</SelectItem>
                {(capabilities.enable_private_shows !== false || editingShow?.visibility === 'members') && <SelectItem id="members">{t('visibility.members')}</SelectItem>}
                {(capabilities.enable_private_shows !== false || editingShow?.visibility === 'private') && <SelectItem id="private">{t('visibility.private')}</SelectItem>}
              </Select>
            </div>
            <Checkbox isSelected={Boolean(editingShowForm.explicit)} onValueChange={(explicit) => setEditingShowForm((prev) => ({ ...prev, explicit }))}>
              {t('fields.explicit_show')}
            </Checkbox>
            <Textarea label={t('fields.summary')} value={editingShowForm.summary ?? ''} onValueChange={(summary) => setEditingShowForm((prev) => ({ ...prev, summary }))} />
            <Textarea label={t('fields.description')} value={editingShowForm.description ?? ''} onValueChange={(description) => setEditingShowForm((prev) => ({ ...prev, description }))} />
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setEditingShow(null)}>{t('actions.cancel')}</Button>
            <Button color="primary" isLoading={savingEdit} isDisabled={!editingShowForm.title.trim()} onPress={handleUpdateShow}>{t('studio.save_changes')}</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={editingEpisode !== null} onClose={() => setEditingEpisode(null)} size="2xl">
        <ModalContent>
          <ModalHeader>{t('studio.edit_episode')}</ModalHeader>
          <ModalBody className="gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={t('fields.episode_title')} maxLength={200} value={editingEpisodeForm.title ?? ''} onValueChange={(title) => setEditingEpisodeForm((prev) => ({ ...prev, title }))} />
              {!editingEpisode?.episode.hosted_audio && (
                <Input label={t('fields.audio_url')} type="url" description={t('fields.audio_url_hint')} value={editingEpisodeForm.audio_url ?? ''} onValueChange={(audio_url) => setEditingEpisodeForm((prev) => ({ ...prev, audio_url }))} />
              )}
              <Input label={t('fields.duration_seconds')} type="number" min="0" value={editingEpisodeForm.duration_seconds != null ? String(editingEpisodeForm.duration_seconds) : ''} onValueChange={(value) => setEditingEpisodeForm((prev) => ({ ...prev, duration_seconds: value ? Math.max(0, Number(value)) : undefined }))} />
              <Input label={t('fields.episode_number')} type="number" min="0" value={editingEpisodeForm.episode_number != null ? String(editingEpisodeForm.episode_number) : ''} onValueChange={(value) => setEditingEpisodeForm((prev) => ({ ...prev, episode_number: value ? Math.max(0, Number(value)) : undefined }))} />
              <Input label={t('fields.season_number')} type="number" min="0" value={editingEpisodeForm.season_number != null ? String(editingEpisodeForm.season_number) : ''} onValueChange={(value) => setEditingEpisodeForm((prev) => ({ ...prev, season_number: value ? Math.max(0, Number(value)) : undefined }))} />
              <label className="block text-sm font-medium text-foreground">
                {t('fields.cover_image_file')}
                <input className="mt-1 block w-full text-sm" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setEditingEpisodeCoverFile(event.currentTarget.files?.[0] ?? null)} />
                {editingEpisodeCoverFile && <span className="mt-1 block text-xs text-muted">{editingEpisodeCoverFile.name}</span>}
              </label>
              <Input label={t('fields.scheduled_for')} type="datetime-local" value={editingEpisodeForm.scheduled_for ?? ''} onValueChange={(scheduled_for) => setEditingEpisodeForm((prev) => ({ ...prev, scheduled_for: scheduled_for || undefined }))} />
              <Select label={t('fields.episode_type')} selectedKeys={[editingEpisodeForm.episode_type ?? 'full']} onSelectionChange={(keys) => setEditingEpisodeForm((prev) => ({ ...prev, episode_type: (Array.from(keys)[0] as CreatePodcastEpisodePayload['episode_type']) ?? 'full' }))}>
                <SelectItem id="full">{t('episode.type.full')}</SelectItem>
                <SelectItem id="trailer">{t('episode.type.trailer')}</SelectItem>
                <SelectItem id="bonus">{t('episode.type.bonus')}</SelectItem>
              </Select>
              <Select label={t('fields.visibility')} selectedKeys={[editingEpisodeForm.visibility ?? 'inherit']} onSelectionChange={(keys) => setEditingEpisodeForm((prev) => ({ ...prev, visibility: (Array.from(keys)[0] as CreatePodcastEpisodePayload['visibility']) ?? 'inherit' }))}>
                <SelectItem id="inherit">{t('visibility.inherit')}</SelectItem>
                <SelectItem id="public">{t('visibility.public')}</SelectItem>
                {(capabilities.enable_private_shows !== false || editingEpisode?.episode.visibility === 'members') && <SelectItem id="members">{t('visibility.members')}</SelectItem>}
                {(capabilities.enable_private_shows !== false || editingEpisode?.episode.visibility === 'private') && <SelectItem id="private">{t('visibility.private')}</SelectItem>}
              </Select>
            </div>
            <Checkbox isSelected={Boolean(editingEpisodeForm.explicit)} onValueChange={(explicit) => setEditingEpisodeForm((prev) => ({ ...prev, explicit }))}>
              {t('fields.explicit_episode')}
            </Checkbox>
            <Textarea label={t('fields.summary')} value={editingEpisodeForm.summary ?? ''} onValueChange={(summary) => setEditingEpisodeForm((prev) => ({ ...prev, summary }))} />
            <Textarea label={t('fields.description')} value={editingEpisodeForm.description ?? ''} onValueChange={(description) => setEditingEpisodeForm((prev) => ({ ...prev, description }))} />
            {capabilities.enable_transcripts !== false && (
              <>
                <Textarea label={t('fields.transcript')} value={editingEpisodeForm.transcript ?? ''} onValueChange={(transcript) => setEditingEpisodeForm((prev) => ({ ...prev, transcript }))} />
                <Select label={t('fields.transcript_language')} selectedKeys={[editingEpisodeForm.transcript_language || studioDefaultLanguage]} onSelectionChange={(keys) => setEditingEpisodeForm((prev) => ({ ...prev, transcript_language: String(Array.from(keys)[0] ?? studioDefaultLanguage) }))}>
                  {studioLanguages.map((language) => (
                    <SelectItem key={language} id={language}>{language.toUpperCase()}</SelectItem>
                  ))}
                </Select>
              </>
            )}
            {capabilities.enable_chapters !== false && (
              <Textarea label={t('fields.chapters')} description={t('fields.chapters_hint')} value={editingChaptersText} onValueChange={setEditingChaptersText} />
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setEditingEpisode(null)}>{t('actions.cancel')}</Button>
            <Button color="primary" isLoading={savingEdit} isDisabled={!editingEpisodeForm.title?.trim()} onPress={handleUpdateEpisode}>{t('studio.save_changes')}</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={feedValidation !== null} onClose={() => setFeedValidation(null)} size="md">
        <ModalContent>
          <ModalHeader>
            {feedValidation ? t('studio.feed_validation.title', { title: feedValidation.show.title }) : ''}
          </ModalHeader>
          <ModalBody className="gap-4">
            {feedValidation && (
              <>
                <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${feedValidation.result.valid ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                  {feedValidation.result.valid
                    ? <CheckCircle size={16} aria-hidden="true" />
                    : <XCircle size={16} aria-hidden="true" />}
                  <span>{feedValidation.result.valid ? t('studio.feed_validation.valid') : t('studio.feed_validation.invalid')}</span>
                </div>

                {feedValidation.result.errors.length > 0 && (
                  <div>
                    <h3 className="mb-1 text-sm font-semibold text-danger">{t('studio.feed_validation.errors')}</h3>
                    <ul className="list-inside list-disc space-y-1 text-sm text-muted">
                      {feedValidation.result.errors.map((issue) => (
                        <li key={issue}>{t(`studio.feed_validation.issues.${feedIssueKey(issue)}`, { defaultValue: issue })}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {feedValidation.result.warnings.length > 0 && (
                  <div>
                    <h3 className="mb-1 text-sm font-semibold text-warning">{t('studio.feed_validation.warnings')}</h3>
                    <ul className="list-inside list-disc space-y-1 text-sm text-muted">
                      {feedValidation.result.warnings.map((issue) => (
                        <li key={issue}>{t(`studio.feed_validation.issues.${feedIssueKey(issue)}`, { defaultValue: issue })}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {(feedValidation.result.skipped_episode_count ?? 0) > 0 && (
                  <p className="text-sm text-muted">
                    {t('studio.feed_validation.skipped_episodes', { count: feedValidation.result.skipped_episode_count })}
                  </p>
                )}
              </>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setFeedValidation(null)}>
              {t('actions.close')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
