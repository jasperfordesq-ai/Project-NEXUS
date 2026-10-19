// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for WaitlistTab — the member's own shift waiting lists.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { framerMotionMock } from '@/test/mocks';
import type { ReactNode } from 'react';

vi.mock('@/lib/motion', () => framerMotionMock);

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === 'object' && Object.keys(opts).length > 0) {
        return `${key}:${Object.entries(opts).map(([k, v]) => `${k}=${String(v)}`).join(',')}`;
      }
      return key;
    },
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await import('react-router-dom');
  const React = await import('react');
  return {
    ...actual,
    Link: ({ children, to, ...rest }: { children: ReactNode; to: string; [k: string]: unknown }) =>
      React.createElement('a', { href: String(to), ...rest }, children),
  };
});

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

const { mockToast } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/contexts', () => ({
  useTenant: () => ({ tenantPath: (p: string) => `/test${p}` }),
  useToast: () => mockToast,
}));

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description, action }: { title: string; description?: string; action?: ReactNode }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
      {action}
    </div>
  ),
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { WaitlistTab } from './WaitlistTab';
import { api } from '@/lib/api';

const later = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

const waiting = {
  id: 11,
  position: 2,
  status: 'waiting',
  notified_at: null,
  expires_at: null,
  shift: { id: 71, start_time: later(48), end_time: later(50), capacity: 1 },
  opportunity: { id: 401, title: 'Riverbank clean-up', location: 'Lee Fields' },
  organization: { id: 9, name: 'Green Cork', logo_url: null },
  joined_at: '2026-10-01T09:00:00Z',
};

const offered = {
  ...waiting,
  id: 12,
  position: 1,
  status: 'notified',
  notified_at: '2026-10-18T09:00:00Z',
  expires_at: later(30),
  shift: { id: 72, start_time: later(72), end_time: later(74), capacity: 4 },
  opportunity: { id: 402, title: 'Soup kitchen Saturday', location: '' },
};

describe('WaitlistTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the empty state with a way to browse opportunities', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<WaitlistTab />);

    expect(await screen.findByTestId('empty-state')).toHaveTextContent('waitlist.no_entries_title');
    expect(screen.getByText('applications_empty_cta')).toHaveAttribute('href', '/test/volunteering');
    expect(api.get).toHaveBeenCalledWith('/v2/volunteering/my-waitlists');
  });

  it('shows the queue position for a waiting entry and the deadline for an offered one', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [waiting, offered] });
    render(<WaitlistTab />);

    expect(await screen.findByText('Riverbank clean-up')).toBeInTheDocument();
    expect(screen.getByText('waitlist.position:position=2')).toBeInTheDocument();
    expect(screen.getByText('waitlist.spot_available')).toBeInTheDocument();
    // The offer carries its deadline, so the member knows how long "soon" is.
    expect(screen.getByTestId('waitlist-claim-by-12')).toHaveTextContent('waitlist.claim_by:deadline=');
    expect(screen.queryByTestId('waitlist-claim-by-11')).not.toBeInTheDocument();
    // A single place reads "1 spot", never "1 spots".
    expect(screen.getByText('waitlist.spots:count=1')).toBeInTheDocument();
    // Every entry links to the opportunity the shift belongs to.
    const links = screen.getAllByText('waitlist.view_opportunity').map((el) => el.closest('a'));
    expect(links[0]).toHaveAttribute('href', '/test/volunteering/opportunities/401');
    expect(links[1]).toHaveAttribute('href', '/test/volunteering/opportunities/402');
  });

  it('renders the heading and reloads on Refresh', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<WaitlistTab />);

    expect(screen.getByText('waitlist.heading')).toBeInTheDocument();
    await screen.findByTestId('empty-state');
    fireEvent.click(screen.getByText('waitlist.refresh'));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('only an offered entry has a Claim button, and claiming posts against the shift', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [waiting, offered] });
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { message: 'ok' } });
    render(<WaitlistTab />);

    await screen.findByText('Soup kitchen Saturday');
    expect(screen.queryByTestId('waitlist-claim-11')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('waitlist-claim-12'));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/v2/volunteering/shifts/72/waitlist/promote'));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('waitlist.claim_success'));
    // The list is reloaded so the claimed shift drops off it.
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('tells the member when the place went to someone else, and reloads', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [offered] });
    vi.mocked(api.post).mockResolvedValue({ success: false, error: 'That spot is no longer available.' });
    render(<WaitlistTab />);

    fireEvent.click(await screen.findByTestId('waitlist-claim-12'));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('That spot is no longer available.'));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('asks before leaving, then leaves against the shift and removes the entry', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [waiting] });
    vi.mocked(api.delete).mockResolvedValue({ success: true, data: null });
    render(<WaitlistTab />);

    fireEvent.click(await screen.findByTestId('waitlist-leave-11'));
    expect(await screen.findByText('waitlist.leave_confirm')).toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();

    // The modal's confirm button carries the same label as the row button.
    const confirmButtons = screen.getAllByText('waitlist.leave');
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/v2/volunteering/shifts/71/waitlist'));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('waitlist.leave_success'));
    await waitFor(() => expect(screen.queryByText('Riverbank clean-up')).not.toBeInTheDocument());
  });

  it('shows an error with a retry when the list cannot be loaded', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ success: true, data: [waiting] });
    render(<WaitlistTab />);

    expect(await screen.findByRole('alert')).toHaveTextContent('waitlist.load_error');
    fireEvent.click(screen.getByText('waitlist.try_again'));

    expect(await screen.findByText('Riverbank clean-up')).toBeInTheDocument();
  });
});
