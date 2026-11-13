// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ShareViaDMModal component.
 *
 * Fake timers are used only where we need the debounce to fire (300 ms)
 * and are carefully combined with waitFor via vi.runAllTimersAsync so that
 * React's internal scheduler and the waitFor polling loop both advance.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ---------------------------------------------------------------------------
// Stable mock objects — defined once at module scope, never per-call
// ---------------------------------------------------------------------------

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  })
);

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

// Preserve all real exports from @/lib/helpers (cn etc.) — only override
// resolveAvatarUrl which would attempt absolute URL resolution in jsdom.
vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...actual,
    resolveAvatarUrl: (url: string | null | undefined) => url ?? '',
  };
});

import { api } from '@/lib/api';
import { ShareViaDMModal } from './ShareViaDMModal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_PROPS = {
  isOpen: true,
  onClose: vi.fn(),
  postUrl: 'https://app.project-nexus.ie/test/feed/post/42',
  postContent: 'Hello world post content',
};

const USERS = [
  { id: 1, name: 'Alice Tester', avatar_url: null },
  { id: 2, name: 'Bob Builder', avatar_url: 'https://cdn.example.com/avatar/2.jpg' },
];

/**
 * Fire a change event on the search box, then advance fake timers past the
 * 300 ms debounce so api.get is triggered.  waitFor then polls until the
 * mock resolves.  Must be called inside an act() if needed by the caller.
 */
async function typeAndDebounce(value: string) {
  const search = screen.getByRole('searchbox');
  fireEvent.change(search, { target: { value } });
  // Advance past the 300 ms debounce using vi.runAllTimersAsync — this keeps
  // React's microtask queue drained while advancing fake timers, preventing
  // the "act() warning" / timeout hang that vi.advanceTimersByTime causes.
  await vi.runAllTimersAsync();
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ShareViaDMModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---- Rendering / visibility -----------------------------------------------

  it('renders the modal dialog when open', () => {
    render(<ShareViaDMModal {...DEFAULT_PROPS} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders the modal header title', () => {
    render(<ShareViaDMModal {...DEFAULT_PROPS} />);
    // feed.share.dm_title = "Send in a message"
    expect(screen.getByText("Send in a message")).toBeInTheDocument();
  });

  it('shows the hint text when query is shorter than 2 chars (initial state)', () => {
    render(<ShareViaDMModal {...DEFAULT_PROPS} />);
    // feed.share.dm_hint = "Type at least 2 characters to search"
    expect(screen.getByText('Type at least 2 characters to search')).toBeInTheDocument();
  });

  it('does not render the dialog when isOpen is false', () => {
    render(<ShareViaDMModal {...DEFAULT_PROPS} isOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders a search input', () => {
    render(<ShareViaDMModal {...DEFAULT_PROPS} />);
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('renders the Done button', () => {
    render(<ShareViaDMModal {...DEFAULT_PROPS} />);
    // feed.share.dm_done = "Done"
    expect(screen.getByRole('button', { name: /^Done$/i })).toBeInTheDocument();
  });

  it('calls onClose when the Done button is pressed', () => {
    const onClose = vi.fn();
    render(<ShareViaDMModal {...DEFAULT_PROPS} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /^Done$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ---- Search / debounce ----------------------------------------------------

  it('does NOT call api.get when query is less than 2 chars', async () => {
    render(<ShareViaDMModal {...DEFAULT_PROPS} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'a' } });
    await vi.runAllTimersAsync();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('calls api.get after debounce when user types a query of 2+ chars', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });

    render(<ShareViaDMModal {...DEFAULT_PROPS} />);
    await act(async () => { await typeAndDebounce('al'); });

    expect(api.get).toHaveBeenCalledWith(
      expect.stringContaining('/v2/users?q=al')
    );
  });

  it('renders user results returned by the API', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: USERS });

    render(<ShareViaDMModal {...DEFAULT_PROPS} />);
    await act(async () => { await typeAndDebounce('ali'); });

    expect(screen.getByText('Alice Tester')).toBeInTheDocument();
    expect(screen.getByText('Bob Builder')).toBeInTheDocument();
  });

  it('shows empty state when API returns no users for a 2-char query', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });

    render(<ShareViaDMModal {...DEFAULT_PROPS} />);
    await act(async () => { await typeAndDebounce('zz'); });

    // feed.share.dm_no_results = "Nobody matches that name. Check the spelling and try again."
    expect(screen.getByText("Nobody matches that name. Check the spelling and try again.")).toBeInTheDocument();
  });

  it('handles wrapped API response { data: [...] }', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { data: USERS } });

    render(<ShareViaDMModal {...DEFAULT_PROPS} />);
    await act(async () => { await typeAndDebounce('bo'); });

    expect(screen.getByText('Bob Builder')).toBeInTheDocument();
  });

  // ---- Send / toast ---------------------------------------------------------

  it('sends a DM via api.post and shows success toast', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: USERS });
    vi.mocked(api.post).mockResolvedValue({ success: true });

    render(<ShareViaDMModal {...DEFAULT_PROPS} />);
    await act(async () => { await typeAndDebounce('ali'); });

    // Click the first "Send" button in the user list
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /^Send$/i })[0]);
      await vi.runAllTimersAsync();
    });

    expect(api.post).toHaveBeenCalledWith(
      '/v2/messages',
      expect.objectContaining({
        recipient_id: 1,
        body: expect.stringContaining(DEFAULT_PROPS.postUrl),
      })
    );
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('includes truncated postContent (with ellipsis) when content exceeds 100 chars', async () => {
    const longContent = 'A'.repeat(120);
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [USERS[0]] });
    vi.mocked(api.post).mockResolvedValue({ success: true });

    render(<ShareViaDMModal {...DEFAULT_PROPS} postContent={longContent} />);
    await act(async () => { await typeAndDebounce('ali'); });

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /^Send$/i })[0]);
      await vi.runAllTimersAsync();
    });

    expect(api.post).toHaveBeenCalledWith(
      '/v2/messages',
      expect.objectContaining({ body: expect.stringContaining('...') })
    );
  });

  it('shows error toast when api.post returns success=false', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [USERS[0]] });
    vi.mocked(api.post).mockResolvedValue({ success: false, error: 'Not found' });

    render(<ShareViaDMModal {...DEFAULT_PROPS} />);
    await act(async () => { await typeAndDebounce('ali'); });

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /^Send$/i })[0]);
      await vi.runAllTimersAsync();
    });

    expect(mockToast.error).toHaveBeenCalled();
  });

  it('shows error toast when api.post throws', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [USERS[0]] });
    vi.mocked(api.post).mockRejectedValue(new Error('Network error'));

    render(<ShareViaDMModal {...DEFAULT_PROPS} />);
    await act(async () => { await typeAndDebounce('ali'); });

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /^Send$/i })[0]);
      await vi.runAllTimersAsync();
    });

    expect(mockToast.error).toHaveBeenCalled();
  });

  it('marks the send button as "Sent" after a successful send', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [USERS[0]] });
    vi.mocked(api.post).mockResolvedValue({ success: true });

    render(<ShareViaDMModal {...DEFAULT_PROPS} />);
    await act(async () => { await typeAndDebounce('ali'); });

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /^Send$/i })[0]);
      await vi.runAllTimersAsync();
    });

    // feed.share.dm_sent_label = "Sent"
    expect(screen.getByText('Sent')).toBeInTheDocument();
  });
});
