// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PodcastMiniPlayer } from './PodcastMiniPlayer';
import type { PodcastPlayerContextValue } from '@/contexts/PodcastPlayerContext';

const mockToggle = vi.fn();
const mockClose = vi.fn();
const mockRetry = vi.fn();
let mockPlayer: Partial<PodcastPlayerContextValue> | null = null;
let mockHasFeature = true;

vi.mock('@/contexts/PodcastPlayerContext', () => ({
  usePodcastPlayerOptional: () => mockPlayer,
}));

// 🔴 Both gates are required even when nothing in this file reads them: shared
// components (Breadcrumbs, headers, menus) ask the tenant context whether a
// destination is enabled, and a partial mock makes that call throw during render.
// Granting everything keeps these cases about their own subject.
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    hasModule: vi.fn((_key: string) => true),
    tenant: { id: 2 },
    hasFeature: () => mockHasFeature,
    tenantPath: (p: string) => p,
  }),
}));

vi.mock('@/components/layout/MobileTabBar', () => ({
  useMobileTabBarVisible: () => true,
}));

function playingState(): Partial<PodcastPlayerContextValue> {
  return {
    track: {
      episodeId: 7,
      showSlug: 'my-show',
      episodeSlug: 'ep-one',
      title: 'Episode One',
      showTitle: 'My Show',
      audioUrl: 'https://example.test/audio.mp3',
      durationSeconds: 600,
    },
    status: 'playing',
    currentTime: 120,
    duration: 600,
    playbackRate: 1,
    volume: 1,
    hasError: false,
    toggle: mockToggle,
    close: mockClose,
    retry: mockRetry,
    seekTo: vi.fn(),
  };
}

function renderBar() {
  return render(
    <MemoryRouter>
      <PodcastMiniPlayer />
    </MemoryRouter>,
  );
}

describe('PodcastMiniPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlayer = playingState();
    mockHasFeature = true;
    document.documentElement.style.removeProperty('--miniplayer-offset');
  });

  it('renders nothing when no track is loaded', () => {
    mockPlayer = { ...playingState(), track: null };
    renderBar();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue('--miniplayer-offset')).toBe('');
  });

  it('renders nothing when the podcasts feature is off', () => {
    mockHasFeature = false;
    renderBar();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('shows the track, toggles playback and publishes the layout offset', () => {
    renderBar();

    expect(screen.getByRole('region', { name: 'Now playing' })).toBeInTheDocument();
    expect(screen.getByText('Episode One')).toBeInTheDocument();
    expect(screen.getByText('My Show')).toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue('--miniplayer-offset')).toBe('4.5rem');

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(mockToggle).toHaveBeenCalledTimes(1);

    const link = screen.getByRole('link', { name: 'Open episode page' });
    expect(link.getAttribute('href')).toBe('/podcasts/my-show/ep-one');
  });

  it('closes via the dismiss button', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Close player' }));
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('shows Play when paused', () => {
    mockPlayer = { ...playingState(), status: 'paused' };
    renderBar();
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('offers recovery when the active track fails', () => {
    mockPlayer = { ...playingState(), status: 'error', hasError: true };
    renderBar();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });
});
