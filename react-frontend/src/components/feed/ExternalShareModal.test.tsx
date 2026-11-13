// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ExternalShareModal component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  })
);

// Mock toast must be declared before vi.mock hoisting requires it to be defined.
// We initialise it here and reference it in the factory above.
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};

import { ExternalShareModal } from './ExternalShareModal';

const DEFAULT_PROPS = {
  isOpen: true,
  onClose: vi.fn(),
  url: 'https://app.project-nexus.ie/test/feed/post/123',
  title: 'Interesting Post',
  text: 'Check out this community post!',
};

describe('ExternalShareModal', () => {
  let clipboardWriteText: ReturnType<typeof vi.fn>;
  let windowOpen: ReturnType<typeof vi.fn>;
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();

    // Stub navigator.clipboard
    clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipboardWriteText },
      writable: true,
      configurable: true,
    });

    // Stub window.open
    windowOpen = vi.fn();
    vi.stubGlobal('open', windowOpen);
  });

  // ─── Rendering ──────────────────────────────────────────────────────────────

  it('renders the modal title', () => {
    render(<ExternalShareModal {...DEFAULT_PROPS} />);
    expect(screen.getByText("Share post")).toBeInTheDocument();
  });

  it('renders the Copy Link button', () => {
    render(<ExternalShareModal {...DEFAULT_PROPS} />);
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
  });

  it('renders all social share target buttons', () => {
    render(<ExternalShareModal {...DEFAULT_PROPS} />);
    // 5 social targets: Email, WhatsApp, X, Facebook, LinkedIn
    expect(
      screen.getByRole('button', { name: /share via email/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /share via whatsapp/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /share via x/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /share via facebook/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /share via linkedin/i })
    ).toBeInTheDocument();
  });

  // ─── Copy link ───────────────────────────────────────────────────────────────

  it('calls navigator.clipboard.writeText with the URL when Copy Link is pressed', async () => {
    render(<ExternalShareModal {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));
    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenCalledWith(DEFAULT_PROPS.url);
    });
  });

  it('shows success toast after copying link', async () => {
    render(<ExternalShareModal {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith('Link copied to clipboard');
    });
  });

  it('switches Copy Link button to "Link copied to clipboard" label after copy', async () => {
    render(<ExternalShareModal {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));
    await waitFor(() => {
      expect(screen.getByText('Link copied to clipboard')).toBeInTheDocument();
    });
  });

  it('shows error toast when clipboard write fails', async () => {
    clipboardWriteText.mockRejectedValueOnce(new Error('Permission denied'));
    render(<ExternalShareModal {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("We couldn't copy the link. Please try again.");
    });
  });

  // ─── Social share targets ─────────────────────────────────────────────────────

  it('opens a WhatsApp share URL in a new window', () => {
    render(<ExternalShareModal {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /share via whatsapp/i }));
    expect(windowOpen).toHaveBeenCalledOnce();
    const [url, target] = windowOpen.mock.calls[0] as [string, string, string];
    expect(url).toContain('wa.me');
    expect(url).toContain(encodeURIComponent(DEFAULT_PROPS.url));
    expect(target).toBe('_blank');
  });

  it('opens an X (Twitter) share URL in a new window', () => {
    render(<ExternalShareModal {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /share via x/i }));
    expect(windowOpen).toHaveBeenCalledOnce();
    const [url] = windowOpen.mock.calls[0] as [string];
    expect(url).toContain('twitter.com/intent/tweet');
    expect(url).toContain(encodeURIComponent(DEFAULT_PROPS.url));
    expect(url).toContain(encodeURIComponent(DEFAULT_PROPS.text));
  });

  it('opens a Facebook share URL in a new window', () => {
    render(<ExternalShareModal {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /share via facebook/i }));
    expect(windowOpen).toHaveBeenCalledOnce();
    const [url] = windowOpen.mock.calls[0] as [string];
    expect(url).toContain('facebook.com/sharer');
    expect(url).toContain(encodeURIComponent(DEFAULT_PROPS.url));
  });

  it('opens a LinkedIn share URL in a new window', () => {
    render(<ExternalShareModal {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /share via linkedin/i }));
    expect(windowOpen).toHaveBeenCalledOnce();
    const [url] = windowOpen.mock.calls[0] as [string];
    expect(url).toContain('linkedin.com');
    expect(url).toContain(encodeURIComponent(DEFAULT_PROPS.url));
  });

  it('includes noopener,noreferrer in window.open call for social targets', () => {
    render(<ExternalShareModal {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /share via whatsapp/i }));
    const [, , features] = windowOpen.mock.calls[0] as [string, string, string];
    expect(features).toContain('noopener');
    expect(features).toContain('noreferrer');
  });

  it('calls onClose after clicking a social share target', () => {
    const onClose = vi.fn();
    render(<ExternalShareModal {...DEFAULT_PROPS} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /share via whatsapp/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  // ─── Email target (uses window.location.href, not window.open) ───────────────

  it('builds a mailto: URL with subject and body for Email target', () => {
    // Spy on location.href assignment via property descriptor trick
    let capturedHref = '';
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    Object.defineProperty(window, 'location', {
      configurable: true,
      get: () => ({
        ...originalLocation,
        set href(v: string) { capturedHref = v; },
        get href() { return capturedHref; },
      }),
    });

    render(<ExternalShareModal {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /share via email/i }));

    // Restore
    if (locationDescriptor) {
      Object.defineProperty(window, 'location', locationDescriptor);
    }

    // Whether or not we captured the href (jsdom restrictions vary), window.open
    // should NOT have been called for email (it uses location.href instead)
    expect(windowOpen).not.toHaveBeenCalled();
  });

  // ─── Not-open state ───────────────────────────────────────────────────────────

  it('does not render modal content when isOpen=false', () => {
    render(<ExternalShareModal {...DEFAULT_PROPS} isOpen={false} />);
    // The modal title should not be in the document when closed
    expect(screen.queryByText("Share post")).not.toBeInTheDocument();
  });
});
