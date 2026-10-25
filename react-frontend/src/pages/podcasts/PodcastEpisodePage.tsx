// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { Button, Card, CardBody, Chip, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Select, SelectItem, Spinner, Textarea } from '@/components/ui';
import { PodcastAudioPlayer, trackFromEpisode } from '@/components/podcasts/PodcastAudioPlayer';
import { usePodcastPlayer } from '@/contexts/PodcastPlayerContext';
import { useAuth, useTenant, useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { podcastsApi, type PodcastEpisode } from '@/lib/api/podcasts';
import { episodeAvailability } from '@/lib/podcasts/availability';
import { EpisodeAvailabilityChip } from '@/components/podcasts/EpisodeAvailabilityChip';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import FileText from 'lucide-react/icons/file-text';
import Heart from 'lucide-react/icons/heart';
import Flag from 'lucide-react/icons/flag';

export default function PodcastEpisodePage() {
  const { t } = useTranslation('podcasts');
  const { showSlug = '', episodeSlug = '' } = useParams();
  const { tenantPath } = useTenant();
  const { isAuthenticated } = useAuth();
  const toast = useToast();
  const player = usePodcastPlayer();
  const [episode, setEpisode] = useState<PodcastEpisode | null>(null);
  const [loading, setLoading] = useState(true);
  const [reactionActive, setReactionActive] = useState(false);
  const [reactionCount, setReactionCount] = useState(0);
  const [reacting, setReacting] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('safety');
  const [reportDetails, setReportDetails] = useState('');
  const [reporting, setReporting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  usePageTitle(episode?.title ?? t('episode.title'));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    podcastsApi.episode(showSlug, episodeSlug)
      .then((res) => {
        if (cancelled) return;
        const data = res.success && res.data ? res.data : null;
        setEpisode(data);
        if (!data && res.code && res.code !== 'RESOURCE_NOT_FOUND' && res.code !== 'NOT_FOUND') {
          setLoadError(res.error || t('episode.load_failed'));
        }
        setReactionActive(Boolean(data?.viewer_has_reacted));
        setReactionCount(data?.reaction_count ?? 0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [showSlug, episodeSlug, retryKey, t]);

  // Keyboard shortcuts: space play/pause, arrows seek, up/down volume.
  // Guarded so typing in the report form (or any focusable control) is
  // never hijacked. keydown counts as a user gesture, so space can also
  // start playback for a not-yet-active episode.
  useEffect(() => {
    if (!episode) return;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, a, [contenteditable="true"], [role="slider"], [role="dialog"], [role="listbox"]')) return;

      const isActive = player.track?.episodeId === episode!.id;
      switch (event.key) {
        case ' ':
          event.preventDefault();
          if (isActive) {
            player.toggle();
          } else {
            player.load(trackFromEpisode(episode!, episode!.show?.slug ?? showSlug), { autoplay: true });
          }
          break;
        case 'ArrowLeft':
          if (isActive) {
            event.preventDefault();
            player.skip(-15);
          }
          break;
        case 'ArrowRight':
          if (isActive) {
            event.preventDefault();
            player.skip(30);
          }
          break;
        case 'ArrowUp':
          if (isActive) {
            event.preventDefault();
            player.setVolume(player.volume + 0.1);
          }
          break;
        case 'ArrowDown':
          if (isActive) {
            event.preventDefault();
            player.setVolume(player.volume - 0.1);
          }
          break;
        default:
          break;
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [episode, player, showSlug]);

  async function handleReaction(): Promise<void> {
    if (!episode || !isAuthenticated || reacting) return;
    setReacting(true);
    const res = await podcastsApi.toggleReaction(episode.id);
    setReacting(false);
    if (res.success && res.data) {
      setReactionActive(res.data.active);
      setReactionCount((count) => Math.max(0, count + (res.data!.active ? 1 : -1)));
    } else {
      toast.error(t('episode.reaction_failed'));
    }
  }

  async function handleReport(): Promise<void> {
    if (!episode || !isAuthenticated) return;
    setReporting(true);
    const res = await podcastsApi.reportEpisode(episode.id, { reason: reportReason, details: reportDetails.trim() || undefined });
    setReporting(false);
    if (res.success) {
      setReportOpen(false);
      setReportDetails('');
      toast.success(t('episode.reported'));
    } else {
      toast.error(t('episode.report_failed'));
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20" role="status" aria-busy="true">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!episode) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-lg font-medium">{loadError ? t('episode.load_failed') : t('episode.not_found')}</p>
        {loadError && <p className="mt-1 text-sm text-muted" role="alert">{loadError}</p>}
        {loadError && (
          <Button className="mt-4" variant="secondary" onPress={() => setRetryKey((value) => value + 1)}>
            {t('episode.retry')}
          </Button>
        )}
        <Button as={Link} to={tenantPath('/podcasts')} className="mt-4" variant="tertiary">
          {t('actions.back_to_podcasts')}
        </Button>
      </div>
    );
  }

  const showPath = episode.show?.slug ?? showSlug;

  function handleDownloadTranscript(): void {
    if (!episode?.transcript) return;
    // Use a Blob URL rather than a data: URI — long transcripts exceed the
    // browser data-URL length cap and would silently fail to download.
    const blob = new Blob([episode.transcript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${episode.slug}-transcript.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <Button as={Link} to={tenantPath(`/podcasts/${showPath}`)} variant="tertiary" size="sm" startContent={<ArrowLeft className="rtl:rotate-180" size={16} aria-hidden="true" />}>
        {t('actions.back_to_show')}
      </Button>

      <article className="mt-5 space-y-6">
        <header>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Chip size="sm" variant="soft">{t(`episode.type.${episode.episode_type}`, { defaultValue: episode.episode_type })}</Chip>
            {/* 🔴 This chip used to show the MODERATION state whenever the episode was not
                live, so an unpublished draft read "Approved". */}
            <EpisodeAvailabilityChip episode={episode} />
          </div>
          {episodeAvailability(episode, String) !== null && (
            <p className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground" role="note">
              {t('episode.unlisted_notice')}
            </p>
          )}
          <h1 className="text-3xl font-bold leading-tight">{episode.title}</h1>
          <p className="mt-2 text-sm text-muted">
            {episode.show?.title ? t('episode.from_show', { title: episode.show.title }) : t('title')}
          </p>
          {episode.summary && <p className="mt-4 text-base">{episode.summary}</p>}
        </header>

        <Card>
          <CardBody className="space-y-3">
            <PodcastAudioPlayer episode={episode} showSlug={showPath} />
            <p className="hidden flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted md:flex">
              <span className="sr-only">{t('player.shortcuts_label')}</span>
              <span><kbd className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-sans">{t('player.key_space')}</kbd> {t('player.shortcut_play_pause')}</span>
              <span><kbd className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-sans">←</kbd> <kbd className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-sans">→</kbd> {t('player.shortcut_seek')}</span>
              <span><kbd className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-sans">↑</kbd> <kbd className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-sans">↓</kbd> {t('player.shortcut_volume')}</span>
            </p>
          </CardBody>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          {isAuthenticated && episode.reactions_enabled !== false && (
            <Button
              variant={reactionActive ? 'secondary' : 'tertiary'}
              size="sm"
              startContent={<Heart size={16} aria-hidden="true" />}
              onPress={handleReaction}
              isDisabled={reacting}
              aria-pressed={reactionActive}
            >
              {reactionActive ? t('episode.reacted') : t('episode.react')}
            </Button>
          )}
          {episode.reactions_enabled !== false && reactionCount > 0 && (
            <span className="text-sm text-muted">{t('episode.reactions_count', { count: reactionCount })}</span>
          )}
          {isAuthenticated && (
            <Button variant="tertiary" size="sm" startContent={<Flag size={16} aria-hidden="true" />} onPress={() => setReportOpen(true)}>
              {t('episode.report')}
            </Button>
          )}
        </div>

        {episode.description && (
          <section>
            <h2 className="mb-2 text-lg font-semibold">{t('episode.description')}</h2>
            <p className="whitespace-pre-line text-sm text-muted">{episode.description}</p>
          </section>
        )}

        {episode.transcripts_enabled !== false && episode.transcript && (
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{t('episode.transcript')}</h2>
              <Button
                onPress={handleDownloadTranscript}
                size="sm"
                variant="tertiary"
                startContent={<FileText size={16} aria-hidden="true" />}
              >
                {t('episode.download_transcript')}
              </Button>
            </div>
            <div className="max-h-[28rem] overflow-auto rounded-lg border border-border bg-surface-secondary/50 p-4 text-sm leading-6 text-foreground">
              <p className="whitespace-pre-line">{episode.transcript}</p>
            </div>
          </section>
        )}
      </article>

      <Modal isOpen={reportOpen} onClose={() => setReportOpen(false)} size="md">
        <ModalContent>
          <ModalHeader>{t('episode.report_title')}</ModalHeader>
          <ModalBody className="gap-4">
            <Select
              label={t('episode.report_reason')}
              selectedKeys={[reportReason]}
              onSelectionChange={(keys) => setReportReason((Array.from(keys)[0] as string) ?? 'safety')}
            >
              <SelectItem id="safety">{t('episode.report_reasons.safety')}</SelectItem>
              <SelectItem id="spam">{t('episode.report_reasons.spam')}</SelectItem>
              <SelectItem id="rights">{t('episode.report_reasons.rights')}</SelectItem>
              <SelectItem id="other">{t('episode.report_reasons.other')}</SelectItem>
            </Select>
            <Textarea
              label={t('episode.report_details')}
              value={reportDetails}
              onValueChange={setReportDetails}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setReportOpen(false)}>
              {t('actions.cancel')}
            </Button>
            <Button color="danger" isLoading={reporting} onPress={handleReport}>
              {t('episode.submit_report')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
