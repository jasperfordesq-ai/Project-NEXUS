// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── No API calls — VideoUploader is a pure UI component ─────────────────────

// ─── Contexts ─────────────────────────────────────────────────────────────────
vi.mock('@/contexts', () => createMockContexts());
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Stub HeroUI Button to forward onPress as onClick ─────────────────────────
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    Button: ({
      children, onPress, isIconOnly, isDisabled, startContent, size, variant, className, 'aria-label': ariaLabel,
    }: {
      children?: React.ReactNode; onPress?: () => void; isIconOnly?: boolean; isDisabled?: boolean;
      startContent?: React.ReactNode; size?: string; variant?: string; className?: string; 'aria-label'?: string;
    }) => (
      <button
        onClick={() => onPress?.()}
        disabled={isDisabled}
        aria-label={ariaLabel}
        className={className}
      >
        {!isIconOnly && startContent}
        {children}
      </button>
    ),
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
const makeVideoFile = (name = 'sample.mp4', type = 'video/mp4', sizeBytes = 1024 * 100) => {
  const file = new File(['x'.repeat(sizeBytes)], name, { type });
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return file;
};

const defaultProps = {
  onVideoSelect: vi.fn(),
  onVideoRemove: vi.fn(),
  selectedVideo: null as File | null,
};

/**
 * The component's own validation message: `<div role="alert">` with the error text.
 *
 * 🔴 Must use queryAllByRole, not getAllByRole. Every assertion here used to call
 * getAllByRole('alert') on the belief that the ToastProvider always renders a
 * persistent empty role="alert" container, so the list could never be empty. It
 * no longer does — and getAllByRole THROWS on zero matches, so the three tests
 * asserting that NO error is shown blew up on the query itself before reaching
 * their assertion. queryAllByRole returns [] instead, which is what "may be
 * absent" needs.
 */
const findErrorAlert = () =>
  screen
    .queryAllByRole('alert')
    .find((el) => el.textContent && el.textContent.trim().length > 0);

// ─────────────────────────────────────────────────────────────────────────────
describe('VideoUploader', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders an upload button when no video is selected', async () => {
    const { VideoUploader } = await import('./VideoUploader');
    render(<VideoUploader {...defaultProps} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('does not show the file preview area when selectedVideo is null', async () => {
    const { VideoUploader } = await import('./VideoUploader');
    render(<VideoUploader {...defaultProps} />);

    // No filename text shown yet
    expect(screen.queryByText('sample.mp4')).toBeNull();
  });

  it('shows the selected video filename when a file is provided', async () => {
    const file = makeVideoFile('my-video.mp4');
    const { VideoUploader } = await import('./VideoUploader');
    render(<VideoUploader {...defaultProps} selectedVideo={file} />);

    expect(screen.getByText('my-video.mp4')).toBeInTheDocument();
  });

  it('shows the file size when a video is selected', async () => {
    const file = makeVideoFile('clip.mp4', 'video/mp4', 2 * 1024 * 1024); // 2MB
    const { VideoUploader } = await import('./VideoUploader');
    render(<VideoUploader {...defaultProps} selectedVideo={file} />);

    expect(screen.getByText(/MB/)).toBeInTheDocument();
  });

  it('hides the select-video button when a video is already selected', async () => {
    const file = makeVideoFile();
    const { VideoUploader } = await import('./VideoUploader');
    render(<VideoUploader {...defaultProps} selectedVideo={file} />);

    // When a video is selected, the initial "Video" upload button is hidden;
    // only the remove button remains (aria-label contains 'remove')
    const buttons = screen.getAllByRole('button');
    const removeBtn = buttons.find((b) => b.getAttribute('aria-label'));
    expect(removeBtn).toBeDefined();
    // The upload-trigger button (no aria-label) should NOT be present
    const uploadBtn = buttons.find((b) => !b.getAttribute('aria-label') && b.textContent?.toLowerCase().includes('video'));
    expect(uploadBtn).toBeUndefined();
  });

  it('calls onVideoSelect with the selected file on valid input change', async () => {
    const onVideoSelect = vi.fn();
    const { VideoUploader } = await import('./VideoUploader');
    render(<VideoUploader {...defaultProps} onVideoSelect={onVideoSelect} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();

    const file = makeVideoFile('clip.mp4', 'video/mp4');
    fireEvent.change(input, { target: { files: [file] } });

    expect(onVideoSelect).toHaveBeenCalledWith(file);
  });

  it('does not call onVideoSelect for an unsupported file type', async () => {
    const onVideoSelect = vi.fn();
    const { VideoUploader } = await import('./VideoUploader');
    render(<VideoUploader {...defaultProps} onVideoSelect={onVideoSelect} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const badFile = new File(['x'], 'bad.avi', { type: 'video/avi' });
    fireEvent.change(input, { target: { files: [badFile] } });

    expect(onVideoSelect).not.toHaveBeenCalled();
  });

  it('shows an error message for an unsupported file type', async () => {
    const { VideoUploader } = await import('./VideoUploader');
    render(<VideoUploader {...defaultProps} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const badFile = new File(['x'], 'movie.avi', { type: 'video/avi' });
    fireEvent.change(input, { target: { files: [badFile] } });

    expect(findErrorAlert()).toBeDefined();
  });

  it('does not call onVideoSelect when file is too large (>100 MB)', async () => {
    const onVideoSelect = vi.fn();
    const { VideoUploader } = await import('./VideoUploader');
    render(<VideoUploader {...defaultProps} onVideoSelect={onVideoSelect} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const bigFile = makeVideoFile('huge.mp4', 'video/mp4', 101 * 1024 * 1024);
    fireEvent.change(input, { target: { files: [bigFile] } });

    expect(onVideoSelect).not.toHaveBeenCalled();
  });

  it('shows an error message when file is too large', async () => {
    const { VideoUploader } = await import('./VideoUploader');
    render(<VideoUploader {...defaultProps} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const bigFile = makeVideoFile('huge.mp4', 'video/mp4', 101 * 1024 * 1024);
    fireEvent.change(input, { target: { files: [bigFile] } });

    expect(findErrorAlert()).toBeDefined();
  });

  it('calls onVideoRemove when the remove button is clicked', async () => {
    const onVideoRemove = vi.fn();
    const file = makeVideoFile();
    const { VideoUploader } = await import('./VideoUploader');
    render(<VideoUploader {...defaultProps} selectedVideo={file} onVideoRemove={onVideoRemove} />);

    const removeBtn = screen.getByRole('button', { name: /remove/i });
    fireEvent.click(removeBtn);

    expect(onVideoRemove).toHaveBeenCalledTimes(1);
  });

  it('clears any error when a valid file is chosen after an invalid attempt', async () => {
    const onVideoSelect = vi.fn();
    const { VideoUploader } = await import('./VideoUploader');
    render(<VideoUploader {...defaultProps} onVideoSelect={onVideoSelect} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    // First: trigger an error with a bad file
    fireEvent.change(input, { target: { files: [new File(['x'], 'bad.avi', { type: 'video/avi' })] } });
    expect(findErrorAlert()).toBeDefined();

    // Then: pick a valid file
    const goodFile = makeVideoFile('good.mp4', 'video/mp4');
    fireEvent.change(input, { target: { files: [goodFile] } });

    // Error message text should be gone.
    expect(findErrorAlert()).toBeUndefined();
  });

  it('accepts video/webm files as valid', async () => {
    const onVideoSelect = vi.fn();
    const { VideoUploader } = await import('./VideoUploader');
    render(<VideoUploader {...defaultProps} onVideoSelect={onVideoSelect} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const webmFile = makeVideoFile('clip.webm', 'video/webm');
    fireEvent.change(input, { target: { files: [webmFile] } });

    expect(onVideoSelect).toHaveBeenCalledWith(webmFile);
    // No error message text.
    expect(findErrorAlert()).toBeUndefined();
  });

  it('accepts video/quicktime files as valid', async () => {
    const onVideoSelect = vi.fn();
    const { VideoUploader } = await import('./VideoUploader');
    render(<VideoUploader {...defaultProps} onVideoSelect={onVideoSelect} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const movFile = makeVideoFile('clip.mov', 'video/quicktime');
    fireEvent.change(input, { target: { files: [movFile] } });

    expect(onVideoSelect).toHaveBeenCalledWith(movFile);
  });

  it('shows no error initially', async () => {
    const { VideoUploader } = await import('./VideoUploader');
    render(<VideoUploader {...defaultProps} />);

    // No error text rendered.
    expect(findErrorAlert()).toBeUndefined();
  });
});
