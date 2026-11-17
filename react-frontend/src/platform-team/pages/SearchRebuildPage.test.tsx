// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { apiGet, apiPost, toast } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: { get: apiGet, post: apiPost } }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/contexts', () => ({ useToast: () => toast }));
// The page formats with getFormattingLocale() (language + community region).
// Pin it to the locale these expected strings are written in.
vi.mock('@/lib/helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/helpers')>()),
  getFormattingLocale: () => 'en',
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'count' in options
        ? `${key}|${String(options.count)}${'time' in options ? `|${String(options.time)}` : ''}`
        : key,
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/admin/components/ConfirmModal', () => ({
  ConfirmModal: ({ isOpen, onConfirm, onClose, title, message }: { isOpen: boolean; onConfirm: () => void; onClose: () => void; title: string; message: string }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <p>{message}</p>
        <button onClick={onConfirm}>confirm</button>
        <button onClick={onClose}>cancel</button>
      </div>
    ) : null,
}));

import { SearchRebuildPage } from './SearchRebuildPage';

type Last = {
  state: string;
  started_at: string | null;
  finished_at: string | null;
  counts: Record<string, number> | null;
  errors: number;
} | null;

function community(id: number, last: Last, name = `Community ${id}`) {
  return { id, name, slug: `c${id}`, is_active: true, last };
}

const DONE: Last = {
  state: 'done',
  started_at: '2026-11-16T10:00:00+00:00',
  finished_at: '2026-11-16T10:05:00+00:00',
  counts: { listing: 3, user: 4, event: 1, group: 2, marketplace: 0 },
  errors: 0,
};

function reply(communities: unknown[], available = true) {
  return { success: true, data: { search_available: available, communities } };
}

function row(id: number): HTMLElement {
  return screen.getByTestId(`search-rebuild-${id}`);
}

describe('SearchRebuildPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    apiPost.mockResolvedValue({ success: true, data: { queued: true } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('says whether search can be reached and gives each community its last result in words', async () => {
    apiGet.mockResolvedValue(reply([
      community(1, null),
      community(2, DONE),
      community(3, { ...DONE, errors: 2 }),
      community(4, { state: 'failed', started_at: null, finished_at: '2026-11-16T10:05:00+00:00', counts: null, errors: 0 }),
    ]));
    render(<SearchRebuildPage />);

    await waitFor(() => expect(row(1)).toBeInTheDocument());
    expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/search-rebuild');
    expect(screen.getByText('search_rebuild.available')).toBeInTheDocument();
    expect(within(row(1)).getByText('search_rebuild.last.never')).toBeInTheDocument();
    expect(within(row(2)).getByText(/search_rebuild\.last\.done\|10/)).toBeInTheDocument();
    expect(within(row(3)).getByText(/search_rebuild\.last\.done_with_errors\|2/)).toBeInTheDocument();
    expect(within(row(4)).getByText('search_rebuild.last.failed')).toBeInTheDocument();
  });

  // Day, month, year, hour and minute, as every other page in the panel: no seconds.
  it('writes when a rebuild finished the way the other pages write a time', async () => {
    apiGet.mockResolvedValue(reply([community(2, DONE)]));
    render(<SearchRebuildPage />);

    await waitFor(() => expect(row(2)).toBeInTheDocument());
    const when = new Date(DONE!.finished_at!).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' });
    expect(within(row(2)).getByText(`search_rebuild.last.done|10|${when}`)).toBeInTheDocument();
  });

  it('says so when the search service cannot be reached', async () => {
    apiGet.mockResolvedValue(reply([community(1, null)], false));
    render(<SearchRebuildPage />);

    expect(await screen.findByText('search_rebuild.unavailable')).toBeInTheDocument();
  });

  it('asks first, says what a rebuild does and does not do, and starts it only after a yes', async () => {
    apiGet.mockResolvedValue(reply([community(2, null)]));
    render(<SearchRebuildPage />);
    await waitFor(() => expect(row(2)).toBeInTheDocument());

    fireEvent.click(within(row(2)).getByRole('button', { name: 'search_rebuild.rebuild' }));
    expect(apiPost).not.toHaveBeenCalled();
    expect(within(screen.getByRole('dialog')).getByText('search_rebuild.confirm_message')).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('dialog')).getByText('confirm'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/v2/platform-team/search-rebuild', { tenant_id: 2 }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('search_rebuild.started'));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
  });

  it('does not start anything when the question is cancelled', async () => {
    apiGet.mockResolvedValue(reply([community(2, null)]));
    render(<SearchRebuildPage />);
    await waitFor(() => expect(row(2)).toBeInTheDocument());

    fireEvent.click(within(row(2)).getByRole('button', { name: 'search_rebuild.rebuild' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByText('cancel'));

    expect(apiPost).not.toHaveBeenCalled();
  });

  it.each([
    ['ALREADY_RUNNING', 'search_rebuild.busy'],
    ['SEARCH_UNAVAILABLE', 'search_rebuild.unavailable'],
    ['AUTH_INSUFFICIENT_PERMISSIONS', 'search_rebuild.action_failed'],
  ])('says why when the server refuses with %s, and does not claim it started', async (code, words) => {
    apiGet.mockResolvedValue(reply([community(2, null)]));
    apiPost.mockResolvedValue({ success: false, code, error: 'server words' });
    render(<SearchRebuildPage />);
    await waitFor(() => expect(row(2)).toBeInTheDocument());

    fireEvent.click(within(row(2)).getByRole('button', { name: 'search_rebuild.rebuild' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByText('confirm'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(words));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('does not offer a second start for a community that is waiting or running', async () => {
    apiGet.mockResolvedValue(reply([
      community(2, { state: 'queued', started_at: null, finished_at: null, counts: null, errors: 0 }),
      community(3, { state: 'running', started_at: '2026-11-16T10:00:00+00:00', finished_at: null, counts: null, errors: 0 }),
    ]));
    render(<SearchRebuildPage />);
    await waitFor(() => expect(row(2)).toBeInTheDocument());

    expect(within(row(2)).getByText('search_rebuild.last.queued')).toBeInTheDocument();
    expect(within(row(3)).getByText(/search_rebuild\.last\.running/)).toBeInTheDocument();
    expect(within(row(2)).getByRole('button', { name: 'search_rebuild.rebuild' })).toBeDisabled();
  });

  it('refreshes every 10 seconds while a rebuild is waiting or running, and stops when none is', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiGet
      .mockResolvedValueOnce(reply([community(2, { state: 'running', started_at: '2026-11-16T10:00:00+00:00', finished_at: null, counts: null, errors: 0 })]))
      .mockResolvedValue(reply([community(2, DONE)]));
    render(<SearchRebuildPage />);
    await waitFor(() => expect(row(2)).toBeInTheDocument());
    expect(apiGet).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  it('says when a background check failed, and clears it on the next good one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = reply([community(2, { state: 'running', started_at: '2026-11-16T10:00:00+00:00', finished_at: null, counts: null, errors: 0 })]);
    apiGet
      .mockResolvedValueOnce(running)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(running);
    render(<SearchRebuildPage />);
    await waitFor(() => expect(row(2)).toBeInTheDocument());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(await screen.findByText('search_rebuild.check_failed')).toBeInTheDocument();
    expect(row(2)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await waitFor(() => expect(screen.queryByText('search_rebuild.check_failed')).not.toBeInTheDocument());
  });

  it('shows the row\'s Rebuild button as busy from the yes until the new list arrives', async () => {
    let finish: (value: unknown) => void = () => {};
    apiGet
      .mockResolvedValueOnce(reply([community(2, null)]))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<SearchRebuildPage />);
    await waitFor(() => expect(row(2)).toBeInTheDocument());

    fireEvent.click(within(row(2)).getByRole('button', { name: /search_rebuild\.rebuild/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByText('confirm'));

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    expect(within(row(2)).getByRole('button', { name: /search_rebuild\.rebuild/ })).toHaveAttribute('data-pending', 'true');

    await act(async () => {
      finish(reply([community(2, { state: 'queued', started_at: null, finished_at: null, counts: null, errors: 0 })]));
    });
    await waitFor(() =>
      expect(within(row(2)).getByRole('button', { name: /search_rebuild\.rebuild/ })).not.toHaveAttribute('data-pending'),
    );
  });

  it('stops checking again once the page is left', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiGet.mockResolvedValue(reply([community(2, { state: 'running', started_at: '2026-11-16T10:00:00+00:00', finished_at: null, counts: null, errors: 0 })]));
    const { unmount } = render(<SearchRebuildPage />);
    await waitFor(() => expect(row(2)).toBeInTheDocument());
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('shows the error card, not an empty list, when the list cannot be loaded', async () => {
    apiGet.mockResolvedValue({ success: false, error: 'Forbidden' });
    render(<SearchRebuildPage />);

    expect(await screen.findByTestId('load-error')).toBeInTheDocument();
  });
});
