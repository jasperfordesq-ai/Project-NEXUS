// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { Avatar, Button, Card, CardBody, Chip, Spinner } from '@/components/ui';
import { useAuth, useTenant, useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { API_BASE } from '@/lib/api';
import { resolveThumbnailUrl } from '@/lib/helpers';
import { safePodcastArtworkUrl } from '@/lib/podcasts/artwork';
import { podcastsApi, type PodcastShow } from '@/lib/api/podcasts';
import { episodeAvailability } from '@/lib/podcasts/availability';
import { EpisodeAvailabilityChip } from '@/components/podcasts/EpisodeAvailabilityChip';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Bell from 'lucide-react/icons/bell';
import BellOff from 'lucide-react/icons/bell-off';
import Radio from 'lucide-react/icons/radio';
import Rss from 'lucide-react/icons/rss';

export default function PodcastShowPage() {
  const { t } = useTranslation('podcasts');
  const { showSlug = '' } = useParams();
  const { tenant, tenantPath } = useTenant();
  const { user, isAuthenticated } = useAuth();
  const toast = useToast();
  const [show, setShow] = useState<PodcastShow | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  usePageTitle(show?.title ?? t('title'));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    podcastsApi.show(showSlug)
      .then((res) => {
        if (cancelled) return;
        const data = res.success && res.data ? res.data : null;
        setShow(data);
        if (!data && res.code && res.code !== 'RESOURCE_NOT_FOUND' && res.code !== 'NOT_FOUND') {
          setLoadError(res.error || t('show.load_failed'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [showSlug, retryKey, t]);

  const isOwner = user?.id && show?.owner_user_id === user.id;
  // Not-yet-live episodes reach this page only for the owner and admins; say so.
  const hasUnlistedEpisodes = (show?.episodes ?? []).some((episode) => episodeAvailability(episode, String) !== null);
  const feedUrl = tenant?.id
    ? `${API_BASE}/v2/podcasts/feed/${tenant.id}/${encodeURIComponent(showSlug)}.xml`
    : `${API_BASE}/v2/podcasts/${encodeURIComponent(showSlug)}/feed.xml`;

  async function handleSubscribe(): Promise<void> {
    if (!show || !isAuthenticated || subscribing) return;
    setSubscribing(true);
    const res = await podcastsApi.toggleSubscription(show.id, true);
    setSubscribing(false);
    if (res.success && res.data) {
      setShow((current) => current
        ? {
            ...current,
            is_subscribed: res.data!.subscribed,
            subscriber_count: Math.max(0, (current.subscriber_count ?? 0) + (res.data!.subscribed ? 1 : -1)),
          }
        : current);
      toast.success(res.data.subscribed ? t('show.subscribed') : t('show.unsubscribed'));
    } else {
      toast.error(t('show.subscribe_failed'));
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20" role="status" aria-busy="true">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!show) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-lg font-medium">{loadError ? t('show.load_failed') : t('show.not_found')}</p>
        {loadError && <p className="mt-1 text-sm text-muted" role="alert">{loadError}</p>}
        {loadError && (
          <Button className="mt-4" variant="secondary" onPress={() => setRetryKey((value) => value + 1)}>
            {t('show.retry')}
          </Button>
        )}
        <Button as={Link} to={tenantPath('/podcasts')} className="mt-4" variant="tertiary">
          {t('actions.back_to_podcasts')}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <Button as={Link} to={tenantPath('/podcasts')} variant="tertiary" size="sm" startContent={<ArrowLeft className="rtl:rotate-180" size={16} aria-hidden="true" />}>
        {t('actions.back_to_podcasts')}
      </Button>

      <section className="mt-5 grid gap-6 md:grid-cols-[12rem_1fr]">
        <Avatar
          src={safePodcastArtworkUrl(show.artwork_url) ?? undefined}
          name={show.title}
          radius="md"
          className="h-48 w-48"
          imgProps={safePodcastArtworkUrl(show.artwork_url) ? {
            src: resolveThumbnailUrl(safePodcastArtworkUrl(show.artwork_url), { width: 512, height: 512 }),
            referrerPolicy: 'no-referrer',
          } : undefined}
        />
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Chip size="sm" variant="soft">{t(`visibility.${show.visibility}`, { defaultValue: show.visibility })}</Chip>
            {show.category ? <Chip size="sm" variant="soft">{show.category}</Chip> : null}
            {show.status !== 'published' || show.moderation_status !== 'approved' ? (
              <Chip
                size="sm"
                variant="soft"
                color={show.moderation_status === 'rejected' || show.moderation_status === 'flagged' ? 'danger' : 'warning'}
              >
                {t(`moderation.${show.moderation_status}`, { defaultValue: show.moderation_status })}
              </Chip>
            ) : null}
          </div>
          <h1 className="text-3xl font-bold leading-tight">{show.title}</h1>
          <p className="mt-2 text-sm text-muted">{show.owner?.name ? t('show.byline', { name: show.owner.name }) : t('show.community_show')}</p>
          {show.summary && <p className="mt-4 max-w-3xl text-base text-foreground">{show.summary}</p>}
          {show.description && <p className="mt-3 max-w-3xl whitespace-pre-line text-sm text-muted">{show.description}</p>}

          <div className="mt-5 flex flex-wrap gap-2">
            {show.rss_enabled && (
              <Button as="a" href={feedUrl} variant="tertiary" size="sm" startContent={<Rss size={16} aria-hidden="true" />}>
                {t('show.rss_feed')}
              </Button>
            )}
            {isAuthenticated && !isOwner && (
              <Button
                variant={show.is_subscribed ? 'secondary' : 'tertiary'}
                size="sm"
                startContent={show.is_subscribed ? <BellOff size={16} aria-hidden="true" /> : <Bell size={16} aria-hidden="true" />}
                onPress={handleSubscribe}
                isDisabled={subscribing}
                aria-pressed={show.is_subscribed}
              >
                {show.is_subscribed ? t('show.unsubscribe') : t('show.subscribe')}
              </Button>
            )}
            {isOwner && (
              <Button as={Link} to={tenantPath('/podcasts/studio')} color="primary" size="sm">
                {t('studio.manage_show')}
              </Button>
            )}
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-4 text-xl font-semibold">{t('show.episodes')}</h2>
        {hasUnlistedEpisodes && (
          <p className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground" role="note">
            {t('show.unlisted_notice')}
          </p>
        )}
        {show.episodes && show.episodes.length > 0 ? (
          <div className="space-y-3">
            {show.episodes.map((episode) => (
              <Card key={episode.id}>
                <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link className="font-semibold hover:text-accent" to={tenantPath(`/podcasts/${show.slug}/${episode.slug}`)}>
                        {episode.title}
                      </Link>
                      <EpisodeAvailabilityChip episode={episode} />
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-muted">{episode.summary || episode.description || t('episode.no_summary')}</p>
                  </div>
                  <Button as={Link} to={tenantPath(`/podcasts/${show.slug}/${episode.slug}`)} variant="tertiary" size="sm" startContent={<Radio size={16} aria-hidden="true" />}>
                    {t('episode.listen')}
                  </Button>
                </CardBody>
              </Card>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-surface-secondary/60 px-5 py-8 text-center text-muted">
            {t('show.no_episodes')}
          </div>
        )}
      </section>
    </div>
  );
}
