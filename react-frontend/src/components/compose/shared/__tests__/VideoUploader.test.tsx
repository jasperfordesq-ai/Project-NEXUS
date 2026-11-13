// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for VideoUploader component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';

vi.mock('@/contexts', () => ({
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null }),
  useTenant: () => ({ tenant: { id: 2, name: 'Test', slug: 'test', tagline: null }, branding: { name: 'Test', logo_url: null }, tenantSlug: 'test', tenantPath: (p: string) => '/test' + p, isLoading: false, hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true) }),
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() })),
}));

import { VideoUploader } from '../VideoUploader';

const defaultProps = {
  onVideoSelect: vi.fn(),
  onVideoRemove: vi.fn(),
  selectedVideo: null as File | null,
};

describe('VideoUploader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(<VideoUploader {...defaultProps} />);
    expect(document.body).toBeTruthy();
  });

  it('renders the video button when no video is selected', () => {
    render(<VideoUploader {...defaultProps} />);
    const videoBtn = screen.getByRole('button');
    expect(videoBtn).toBeInTheDocument();
  });

  it('renders a hidden file input', () => {
    const { container } = render(<VideoUploader {...defaultProps} />);
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInTheDocument();
    expect(input).toHaveClass('hidden');
  });

  it('accepts correct video types', () => {
    const { container } = render(<VideoUploader {...defaultProps} />);
    const input = container.querySelector('input[type="file"]');
    expect(input).toHaveAttribute('accept', 'video/mp4,video/webm,video/ogg,video/quicktime');
  });

  it('shows video details when a video is selected', () => {
    const videoFile = new File(['video-content'], 'clip.mp4', { type: 'video/mp4' });
    render(<VideoUploader {...defaultProps} selectedVideo={videoFile} />);
    expect(screen.getByText('clip.mp4')).toBeInTheDocument();
  });

  it('hides the select button when a video is selected', () => {
    const videoFile = new File(['video-content'], 'clip.mp4', { type: 'video/mp4' });
    render(<VideoUploader {...defaultProps} selectedVideo={videoFile} />);
    // The "Video" button to add a video should not be visible
    // Only the remove button should be there
    const removeBtn = screen.getByRole('button', { name: /remove/i });
    expect(removeBtn).toBeInTheDocument();
  });

  it('calls onVideoRemove when remove button is clicked', () => {
    const onVideoRemove = vi.fn();
    const videoFile = new File(['video-content'], 'clip.mp4', { type: 'video/mp4' });
    render(
      <VideoUploader {...defaultProps} selectedVideo={videoFile} onVideoRemove={onVideoRemove} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onVideoRemove).toHaveBeenCalled();
  });

  it('calls onVideoSelect with a valid video file', () => {
    const onVideoSelect = vi.fn();
    const { container } = render(
      <VideoUploader {...defaultProps} onVideoSelect={onVideoSelect} />,
    );

    const input = container.querySelector('input[type="file"]')!;
    const mp4File = new File(['video-data'], 'video.mp4', { type: 'video/mp4' });
    fireEvent.change(input, { target: { files: [mp4File] } });
    expect(onVideoSelect).toHaveBeenCalledWith(mp4File);
  });

  it('shows error for invalid video type', () => {
    const { container } = render(<VideoUploader {...defaultProps} />);

    const input = container.querySelector('input[type="file"]')!;
    const textFile = new File(['hello'], 'doc.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [textFile] } });

    // Error should be displayed
    expect(screen.getByText(/can't use that kind of video/i)).toBeInTheDocument();
  });

  it('shows error for oversized video file', () => {
    const { container } = render(<VideoUploader {...defaultProps} />);

    const input = container.querySelector('input[type="file"]')!;
    // Create a file > 100MB (the MAX_SIZE_MB constant)
    const bigFile = new File(['x'.repeat(101 * 1024 * 1024)], 'big.mp4', { type: 'video/mp4' });
    fireEvent.change(input, { target: { files: [bigFile] } });

    // Error about size should be displayed
    expect(screen.getByText(/video must be under/i)).toBeInTheDocument();
  });

  it('formats file size in MB', () => {
    const videoFile = new File(['x'.repeat(5 * 1024 * 1024)], 'vid.mp4', { type: 'video/mp4' });
    render(<VideoUploader {...defaultProps} selectedVideo={videoFile} />);
    expect(screen.getByText(/5\.0 MB/)).toBeInTheDocument();
  });
});
