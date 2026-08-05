// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Persistent mini-player — a docked bar that appears only while a podcast
 * track is loaded, so audio keeps its controls visible across navigation.
 * Views the shared PodcastPlayerContext; it never owns audio itself.
 *
 * Stacking: sits above the mobile tab bar (its visibility comes from the
 * same `useMobileTabBarVisible` rule, so offsets can't drift) and below it
 * in z-order. Publishes `--miniplayer-offset` on <html> so other floating
 * controls (BackToTop) can move out of the way.
 */

import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Slider } from '@/components/ui';
import { useMobileTabBarVisible } from '@/components/layout/MobileTabBar';
import { usePodcastPlayerOptional } from '@/contexts/PodcastPlayerContext';
import { useTenant } from '@/contexts/TenantContext';
import { formatTime } from '@/components/podcasts/PodcastAudioPlayer';
import Pause from 'lucide-react/icons/pause';
import Play from 'lucide-react/icons/play';
import Podcast from 'lucide-react/icons/podcast';
import X from 'lucide-react/icons/x';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import TriangleAlert from 'lucide-react/icons/triangle-alert';
import { resolveThumbnailUrl } from '@/lib/helpers';
import { safePodcastArtworkUrl } from '@/lib/podcasts/artwork';

interface PodcastMiniPlayerProps {
  /** Whether the layout renders the mobile tab bar at all (Layout's showNavbar). */
  tabBarMayShow?: boolean;
}

export function PodcastMiniPlayer({ tabBarMayShow = true }: PodcastMiniPlayerProps) {
  const { t } = useTranslation('podcasts');
  const { hasFeature, tenantPath } = useTenant();
  const player = usePodcastPlayerOptional();
  const tabBarVisible = useMobileTabBarVisible() && tabBarMayShow;

  const hasTrack = Boolean(player?.track);

  // Let other floating controls (BackToTop) clear the bar while it's docked.
  useEffect(() => {
    if (hasTrack) {
      document.documentElement.style.setProperty('--miniplayer-offset', '4.5rem');
    } else {
      document.documentElement.style.removeProperty('--miniplayer-offset');
    }
    return () => {
      document.documentElement.style.removeProperty('--miniplayer-offset');
    };
  }, [hasTrack]);

  if (!player || !player.track || !hasFeature('podcasts')) return null;

  const { track, status, currentTime, duration, toggle, seekTo, close } = player;
  const isPlaying = status === 'playing' || status === 'loading';
  const episodeHref = track.showSlug
    ? tenantPath(`/podcasts/${track.showSlug}/${track.episodeSlug}`)
    : tenantPath('/podcasts');
  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const safeArtworkUrl = safePodcastArtworkUrl(track.artworkUrl);
  const artworkSrc = safeArtworkUrl
    ? resolveThumbnailUrl(safeArtworkUrl, { width: 160, height: 160 })
    : '';

  return (
    <>
      {/* In-flow spacer so page bottom content isn't hidden behind the fixed bar */}
      <div aria-hidden="true" className="h-[4.5rem]" />

      <div
        role="region"
        aria-label={t('player.now_playing')}
        data-podcast-miniplayer
        className={`fixed inset-x-0 z-[290] transition-transform duration-200 ${
          tabBarVisible
            /* `lg:` must match MobileTabBar's `lg:hidden` — at md the bar is still
               on screen, so docking to bottom-0 there would overlap it. */
            ? 'bottom-[calc(env(safe-area-inset-bottom,0px)+4rem)] lg:bottom-0 lg:pb-[env(safe-area-inset-bottom,0px)]'
            : 'bottom-0 pb-[env(safe-area-inset-bottom,0px)]'
        }`}
      >
        <div className="border-t border-[var(--border-default)] bg-[var(--glass-bg)] shadow-[0_-4px_24px_rgba(0,0,0,0.08)] backdrop-blur-xl">
          {/* Thin always-visible progress line (interactive slider is sm+) */}
          <div className="h-0.5 w-full bg-[var(--border-default)] sm:hidden" aria-hidden="true">
            <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${progressPercent}%` }} />
          </div>

          <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-3 sm:px-4">
            {artworkSrc ? (
              <img src={artworkSrc} alt="" className="size-10 shrink-0 rounded-md object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
            ) : (
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-secondary text-muted">
                <Podcast size={20} aria-hidden="true" />
              </div>
            )}

            <Link
              to={episodeHref}
              className="min-w-0 flex-1 no-underline"
              aria-label={t('player.open_episode')}
            >
              <p className="truncate text-sm font-medium text-foreground">{track.title}</p>
              {track.showTitle && <p className="truncate text-xs text-muted">{track.showTitle}</p>}
            </Link>

            <div className="hidden min-w-0 flex-1 items-center gap-2 sm:flex">
              <span className="shrink-0 text-xs tabular-nums text-muted">{formatTime(currentTime)}</span>
              <Slider
                aria-label={t('player.progress')}
                formatOptions={{ style: 'unit', unit: 'second', unitDisplay: 'long' }}
                size="sm"
                hideValue
                className="flex-1"
                minValue={0}
                maxValue={Math.max(1, duration)}
                step={1}
                value={Math.min(currentTime, Math.max(1, duration))}
                isDisabled={duration <= 0 || player.hasError}
                onChangeEnd={(value) => seekTo(typeof value === 'number' ? value : (value[0] ?? 0))}
              />
              <span className="shrink-0 text-xs tabular-nums text-muted">
                {duration > 0 ? formatTime(duration) : '–:––'}
              </span>
            </div>

            {player.hasError ? (
              <>
                <TriangleAlert className="text-danger" size={16} aria-hidden="true" />
                <Button
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  onPress={player.retry}
                  aria-label={t('player.retry')}
                >
                  <RefreshCw size={16} aria-hidden="true" />
                </Button>
              </>
            ) : (
              <Button
                isIconOnly
                size="sm"
                color="primary"
                onPress={toggle}
                aria-label={isPlaying ? t('player.pause') : t('player.play')}
                aria-pressed={isPlaying}
              >
                {isPlaying ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
              </Button>
            )}
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              onPress={close}
              aria-label={t('player.close_player')}
            >
              <X size={16} aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
