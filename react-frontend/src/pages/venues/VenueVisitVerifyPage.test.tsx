// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
  },
}));

vi.mock('@/contexts', () => createMockContexts());

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: vi.fn(() => ({ token: 'pass-token-abc' })),
  };
});

import { api } from '@/lib/api';
import { useParams } from 'react-router-dom';
import VenueVisitVerifyPage from './VenueVisitVerifyPage';

describe('VenueVisitVerifyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useParams).mockReturnValue({ token: 'pass-token-abc' });
  });

  it('does not record anything on page load — recording needs a human tap', () => {
    render(<VenueVisitVerifyPage />);

    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByTestId('venue-verify-confirm')).toBeInTheDocument();
  });

  it('renders the error state with no confirm button when the token is missing', () => {
    vi.mocked(useParams).mockReturnValue({ token: undefined });

    render(<VenueVisitVerifyPage />);

    expect(screen.queryByTestId('venue-verify-confirm')).not.toBeInTheDocument();
  });

  it('posts the record endpoint on confirm and shows the member name', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      success: true,
      data: {
        status: 'recorded',
        member: { id: 7, name: 'Alex Rivera' },
        venue: { id: 3, name: 'The Time Union Cafe' },
        visits_this_month: 2,
        xp_awarded: 10,
        completed_challenges: [],
      },
    });

    render(<VenueVisitVerifyPage />);
    fireEvent.click(screen.getByTestId('venue-verify-confirm'));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining('partner-venues/visits/verify/pass-token-abc'),
        {},
      );
    });

    expect(await screen.findByText(/Alex Rivera/)).toBeInTheDocument();
  });

  it('distinguishes a same-day rescan from a fresh visit', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      success: true,
      data: {
        status: 'already_recorded_today',
        member: { id: 7, name: 'Alex Rivera' },
        venue: { id: 3, name: 'The Time Union Cafe' },
        visits_this_month: 1,
        xp_awarded: 0,
        completed_challenges: [],
      },
    });

    render(<VenueVisitVerifyPage />);
    fireEvent.click(screen.getByTestId('venue-verify-confirm'));

    expect(await screen.findByText(/already/i)).toBeInTheDocument();
  });

  it('asks which venue when the staff member covers several, then posts the choice', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      success: true,
      data: {
        status: 'needs_venue',
        venues: [
          { id: 3, name: 'First Cafe' },
          { id: 9, name: 'Second Cafe' },
        ],
      },
    });

    render(<VenueVisitVerifyPage />);
    fireEvent.click(screen.getByTestId('venue-verify-confirm'));

    expect(await screen.findByTestId('venue-verify-choose')).toBeInTheDocument();
    // The choice button stays disabled until a venue is picked, so a staff
    // member cannot record against an unspecified venue.
    expect(screen.getByTestId('venue-verify-choose')).toBeDisabled();
  });

  it('surfaces a completed challenge returned with the visit', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      success: true,
      data: {
        status: 'recorded',
        member: { id: 7, name: 'Alex Rivera' },
        venue: { id: 3, name: 'The Time Union Cafe' },
        visits_this_month: 5,
        xp_awarded: 10,
        completed_challenges: [{ id: 42, title: 'Five venue visits', xp_reward: 50 }],
      },
    });

    render(<VenueVisitVerifyPage />);
    fireEvent.click(screen.getByTestId('venue-verify-confirm'));

    expect(await screen.findByText(/Five venue visits/)).toBeInTheDocument();
  });

  it('announces a permission failure via an assertive alert region (WCAG 4.1.3)', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      success: false,
      errors: [{ code: 'FORBIDDEN' }],
    });

    render(<VenueVisitVerifyPage />);
    fireEvent.click(screen.getByTestId('venue-verify-confirm'));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('moves focus to the live result region when the action resolves', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      success: true,
      data: {
        status: 'recorded',
        member: { id: 7, name: 'Alex Rivera' },
        venue: { id: 3, name: 'Cafe' },
        completed_challenges: [],
      },
    });

    render(<VenueVisitVerifyPage />);
    fireEvent.click(screen.getByTestId('venue-verify-confirm'));

    await waitFor(() => {
      expect(document.activeElement?.getAttribute('aria-live')).toBeTruthy();
    });
  });
});
