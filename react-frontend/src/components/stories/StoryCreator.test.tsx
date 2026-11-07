// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';
import userEvent from '@testing-library/user-event';

// ─── API mock ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
}));
vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/compress-image', () => ({ compressImage: vi.fn(async (f: File) => f) }));

// ─── Toast / Auth / Tenant ──────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({
      user: { id: 1, name: 'Test User' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
  })
);

// ─── Stub heavy HeroUI components that misbehave in jsdom ───────────────────
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...actual,
    Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
      isOpen ? <div role="dialog" aria-label="Dialog">{children}</div> : null,
    ModalContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ModalBody: ({ children, ...rest }: { children: React.ReactNode; [key: string]: unknown }) => (
      <div {...rest}>{children}</div>
    ),
    Textarea: ({ value, onValueChange, placeholder, ...rest }: {
      value?: string;
      onValueChange?: (v: string) => void;
      placeholder?: string;
      [key: string]: unknown;
    }) => (
      <textarea
        value={value}
        onChange={(e) => onValueChange?.(e.target.value)}
        placeholder={placeholder}
        data-testid="textarea"
        {...(rest as object)}
      />
    ),
    Input: ({ value, onValueChange, placeholder, ...rest }: {
      value?: string;
      onValueChange?: (v: string) => void;
      placeholder?: string;
      [key: string]: unknown;
    }) => (
      <input
        value={value}
        onChange={(e) => onValueChange?.(e.target.value)}
        placeholder={placeholder}
        data-testid="input"
        {...(rest as object)}
      />
    ),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
describe('StoryCreator', () => {
  const defaultProps = {
    onClose: vi.fn(),
    onCreated: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.post.mockResolvedValue({ success: true });
    mockApi.upload.mockResolvedValue({ success: true });
  });

  it('renders without crashing in text mode (default)', async () => {
    const { StoryCreator } = await import('./StoryCreator');
    render(<StoryCreator {...defaultProps} />);
    // Dialog role should be present
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows mode tabs for photo, video, text, poll', async () => {
    const { StoryCreator } = await import('./StoryCreator');
    render(<StoryCreator {...defaultProps} />);
    // Buttons with aria-label containing "mode" for each story type
    expect(screen.getByRole('button', { name: /photo mode/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /video mode/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /text mode/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /poll mode/i })).toBeInTheDocument();
  });

  it('shows discard and share story buttons', async () => {
    const { StoryCreator } = await import('./StoryCreator');
    render(<StoryCreator {...defaultProps} />);
    // bottom bar buttons
    const buttons = screen.getAllByRole('button');
    const discardBtn = buttons.find((b) => b.textContent?.toLowerCase().includes('discard'));
    const shareBtn = buttons.find((b) => b.textContent?.toLowerCase().includes('share'));
    expect(discardBtn).toBeDefined();
    expect(shareBtn).toBeDefined();
  });

  it('calls onClose when close button is pressed', async () => {
    const onClose = vi.fn();
    const { StoryCreator } = await import('./StoryCreator');
    render(<StoryCreator {...defaultProps} onClose={onClose} />);
    // There may be multiple "close" labelled buttons; find the one in the header
    const closeBtns = screen.getAllByRole('button', { name: /close/i });
    // Click the first one which is the header X
    await userEvent.click(closeBtns[0]!);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows audience selector buttons (everyone, connections, close friends)', async () => {
    const { StoryCreator } = await import('./StoryCreator');
    render(<StoryCreator {...defaultProps} />);
    expect(screen.getByRole('button', { name: /everyone/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connections/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close friends/i })).toBeInTheDocument();
  });

  it('shows text mode textarea for composing when text mode active', async () => {
    const { StoryCreator } = await import('./StoryCreator');
    render(<StoryCreator {...defaultProps} />);
    // Text mode is default - textarea should be visible
    const textarea = screen.getByTestId('textarea');
    expect(textarea).toBeInTheDocument();
  });

  it('posts text story when share is clicked with content', async () => {
    const onCreated = vi.fn();
    const { StoryCreator } = await import('./StoryCreator');
    render(<StoryCreator {...defaultProps} onCreated={onCreated} />);

    // Type into the textarea
    const textarea = screen.getByTestId('textarea');
    fireEvent.change(textarea, { target: { value: 'Hello world story!' } });

    const shareBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('share')
    );
    expect(shareBtn).toBeDefined();
    await userEvent.click(shareBtn!);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        '/v2/stories',
        expect.objectContaining({ media_type: 'text', text_content: 'Hello world story!' })
      );
    });
  });

  it('shows error toast when text story submit fails', async () => {
    mockApi.post.mockResolvedValue({ success: false, error: 'Server error' });
    const { StoryCreator } = await import('./StoryCreator');
    render(<StoryCreator {...defaultProps} />);

    const textarea = screen.getByTestId('textarea');
    fireEvent.change(textarea, { target: { value: 'Test content' } });

    const shareBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('share')
    );
    await userEvent.click(shareBtn!);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows poll mode inputs when poll tab is clicked', async () => {
    const { StoryCreator } = await import('./StoryCreator');
    render(<StoryCreator {...defaultProps} />);

    const pollTab = screen.getByRole('button', { name: /poll mode/i });
    await userEvent.click(pollTab);

    // Poll mode inputs should appear
    await waitFor(() => {
      const inputs = screen.getAllByTestId('input');
      // Poll question + at least 2 options
      expect(inputs.length).toBeGreaterThanOrEqual(3);
    });
  });

  it('calls onClose when Escape key is pressed', async () => {
    const onClose = vi.fn();
    const { StoryCreator } = await import('./StoryCreator');
    render(<StoryCreator {...defaultProps} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows photo upload options when photo tab is clicked', async () => {
    const { StoryCreator } = await import('./StoryCreator');
    render(<StoryCreator {...defaultProps} />);

    const photoTab = screen.getByRole('button', { name: /photo mode/i });
    await userEvent.click(photoTab);

    await waitFor(() => {
      // Should show camera open or gallery selection button
      const cameraBtn = screen.queryByRole('button', { name: /camera|take photo/i });
      const galleryBtn = screen.queryByRole('button', { name: /gallery|select image/i });
      expect(cameraBtn || galleryBtn).toBeTruthy();
    });
  });

  it('calls onCreated after successful story creation', async () => {
    const onCreated = vi.fn();
    mockApi.post.mockResolvedValue({ success: true });
    const { StoryCreator } = await import('./StoryCreator');
    render(<StoryCreator {...defaultProps} onCreated={onCreated} />);

    const textarea = screen.getByTestId('textarea');
    fireEvent.change(textarea, { target: { value: 'A great story!' } });

    const shareBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('share')
    );
    await userEvent.click(shareBtn!);

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });
  });

  // AWID accessibility report, point 6: every photo a member uploads can be described.
  it('sends the description written for a photo story', async () => {
    const { compressImage } = await import('@/lib/compress-image');
    vi.mocked(compressImage).mockImplementation(async (f: File) => f);
    const { StoryCreator } = await import('./StoryCreator');
    const { container } = render(<StoryCreator {...defaultProps} />);

    await userEvent.click(screen.getByRole('button', { name: /photo mode/i }));
    const fileInput = container.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'IMG_3001.jpg', { type: 'image/jpeg' })] } });

    const description = await screen.findByLabelText('Describe this photo (optional)');
    fireEvent.change(description, { target: { value: 'Our community garden in bloom' } });

    const shareBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('share'));
    await userEvent.click(shareBtn!);

    await waitFor(() => expect(mockApi.upload).toHaveBeenCalled());
    const form = mockApi.upload.mock.calls[0]?.[1] as FormData | undefined;
    expect(form?.get('media_alt')).toBe('Our community garden in bloom');
  });
});
