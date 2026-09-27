// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for VideoPlayer component
 *
 * NOTE: jsdom does not implement HTMLMediaElement media playback.
 *   - HTMLMediaElement.prototype.play / .pause are stubbed with vi.fn().
 *   - Actual playback assertions (e.g. "video is audibly playing") are skipped.
 *   - IntersectionObserver is stubbed to avoid "not a constructor" errors in jsdom.
 *   - Autoplay-on-scroll behaviour is skipped (IntersectionObserver is a no-op stub).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/contexts', () => createMockContexts());

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

// Pass resolveAssetUrl through unchanged so we can assert on the raw URLs
vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...actual,
    resolveAssetUrl: (url: string | null | undefined) => url ?? '',
  };
});

// Stub HTMLMediaElement.prototype.play / pause (jsdom doesn't implement them)
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true,
  value: vi.fn().mockResolvedValue(undefined),
});
Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
  configurable: true,
  value: vi.fn(),
});

// Stub IntersectionObserver — jsdom does not implement it
const observeFn = vi.fn();
const disconnectFn = vi.fn();
const MockIntersectionObserver = vi.fn(function mockIntersectionObserver() { return {
  observe: observeFn,
  disconnect: disconnectFn,
  unobserve: vi.fn(),
}; });
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

import { VideoPlayer } from './VideoPlayer';
import type { PostMedia } from './types';

const MEDIA: PostMedia = {
  id: 1,
  media_type: 'video',
  file_url: 'https://cdn.example.com/video.mp4',
  thumbnail_url: 'https://cdn.example.com/thumb.jpg',
  alt_text: 'A sample video',
  width: 1280,
  height: 720,
  file_size: 5_000_000,
  display_order: 0,
};

describe('VideoPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a <video> element', () => {
    render(<VideoPlayer media={MEDIA} />);
    const video = document.querySelector('video');
    expect(video).not.toBeNull();
  });

  it('sets the video src from media.file_url', () => {
    render(<VideoPlayer media={MEDIA} />);
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe('https://cdn.example.com/video.mp4');
  });

  it('sets the video poster from media.thumbnail_url', () => {
    render(<VideoPlayer media={MEDIA} />);
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('poster')).toBe('https://cdn.example.com/thumb.jpg');
  });

  it('does NOT set a poster when thumbnail_url is null', () => {
    render(<VideoPlayer media={{ ...MEDIA, thumbnail_url: null }} />);
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('poster')).toBeFalsy();
  });

  it('starts muted by default', () => {
    render(<VideoPlayer media={MEDIA} />);
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.muted).toBe(true);
  });

  it('renders the play overlay when paused (initial state)', () => {
    render(<VideoPlayer media={MEDIA} />);
    // The container wrapping the video has role="button". The mute toggle is a separate
    // inner button. The outer container's aria-label is the play/pause translation key.
    // jsdom video starts "paused" so the play state is shown.
    const buttons = screen.getAllByRole('button');
    // At least 2 buttons: outer container (video play/pause), inner mute toggle
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    // The outer container button should have an aria-label
    expect(buttons[0]).toHaveAttribute('aria-label');
  });

  it('renders a mute/unmute button', () => {
    render(<VideoPlayer media={MEDIA} />);
    // There should be at least one button (the mute toggle)
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('calls HTMLMediaElement.play when the container is clicked while paused', () => {
    render(<VideoPlayer media={MEDIA} />);
    // The outer div is role=button. In jsdom video.paused=true always, so clicking plays.
    const buttons = screen.getAllByRole('button');
    // Click the outer container (index 0); the inner mute button is index 1
    fireEvent.click(buttons[0]);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('applies a custom className to the outer container', () => {
    const { container } = render(<VideoPlayer media={MEDIA} className="my-custom-class" />);
    expect(container.firstChild).toHaveClass('my-custom-class');
  });

  it('uses the alt_text as aria-label on the video element', () => {
    render(<VideoPlayer media={{ ...MEDIA, alt_text: 'Community event footage' }} />);
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('aria-label')).toBe('Community event footage');
  });

  it('shows an error state when the video fires an error event', () => {
    render(<VideoPlayer media={MEDIA} />);
    const video = document.querySelector('video') as HTMLVideoElement;

    // Trigger the onError handler
    fireEvent.error(video);

    // After error the play-overlay container (role=button) and the <video> should be gone
    // because hasError renders an entirely different subtree.
    expect(document.querySelector('video')).not.toBeInTheDocument();
    // The error placeholder uses role="status" with aria-label containing 'unavailable'
    const errorStatus = screen.getAllByRole('status').find(
      (el) => el.getAttribute('aria-label')?.includes('unavailable') || el.getAttribute('aria-label')?.includes('video')
    );
    expect(errorStatus).toBeDefined();
  });

  it('observes the container via IntersectionObserver on mount', () => {
    render(<VideoPlayer media={MEDIA} />);
    expect(observeFn).toHaveBeenCalled();
  });

  it('disconnects the IntersectionObserver on unmount', () => {
    const { unmount } = render(<VideoPlayer media={MEDIA} />);
    unmount();
    expect(disconnectFn).toHaveBeenCalled();
  });

  // NOTE: toggling play→pause via click and asserting isPlaying state is skipped
  // because jsdom's HTMLVideoElement.paused is always true and .play() is a stub.
  // The IntersectionObserver-triggered autoplay is also skipped (stub is a no-op).
});
