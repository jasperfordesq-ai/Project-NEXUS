// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';
import type { MatchingListingDiagnosis, MatchingUserDiagnosis } from '../../api/types';

// ---------------------------------------------------------------------------
// Hoist mock fns
// ---------------------------------------------------------------------------
const mockGetMatchingStats = vi.hoisted(() => vi.fn());
const mockDiagnoseUser = vi.hoisted(() => vi.fn());
const mockDiagnoseListing = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());

vi.mock('../../api/adminApi', () => ({
  adminDiagnostics: {
    getMatchingStats: mockGetMatchingStats,
    diagnoseUser: mockDiagnoseUser,
    diagnoseListing: mockDiagnoseListing,
  },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => ({
      success: vi.fn(),
      error: mockToastError,
      info: vi.fn(),
      warning: vi.fn(),
    }),
  })
);

// MatchingDiagnostic uses useAdminPageMeta which reads AdminMetaContext.
// The context is optional (hook gracefully handles null context).
vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/lib/serverTime', () => ({
  formatServerDate: (v: string) => `server:${v}`,
  formatServerDateTime: (v: string) => `server-dt:${v}`,
}));

import { MatchingDiagnostic } from './MatchingDiagnostic';

/**
 * GET /v2/admin/matching/stats exactly as the server names things
 * (total_cached_matches, average_score). The page used to read
 * `cache_entries` / `avg_match_score` straight off this payload, which the
 * server never sent, so all three tiles showed "--".
 */
const ENGINE_STATS = {
  overview: {
    total_cached_matches: 500,
    total_matches_month: 300,
    total_matches_week: 150,
    total_matches_today: 120,
    average_score: 73.4,
    average_distance_km: 4.2,
    active_users_with_matches: 40,
    hot_matches: 12,
    mutual_matches_count: 5,
  },
  score_distribution: [],
  distance_distribution: [],
  pending_approvals: 0,
  approved_count: 0,
  rejected_count: 0,
  approval_rate: 0,
};

const COMMUNITY = {
  matching_enabled: true,
  min_match_score: 40,
  max_distance_km: 30,
  geo_hard_gate: true,
  missing_coords_mode: 'remote_only' as const,
  dormancy_days: 90,
};

const USER_DIAGNOSIS: MatchingUserDiagnosis = {
  member: {
    id: 42,
    name: 'Alice Member',
    status: 'active',
    is_approved: true,
    has_coordinates: false,
    last_active_at: '2026-11-10 09:00:00',
    days_since_active: 7,
    last_login_at: null,
  },
  listings: {
    active_count: 3,
    awaiting_or_refused_review_count: 1,
    by_type: { offer: 2, request: 1 },
    by_category: [
      { type: 'offer', category_name: 'Gardening', count: 2 },
      { type: 'request', category_name: null, count: 1 },
    ],
  },
  preferences: {
    has_saved_preferences: true,
    matching_paused: true,
    min_match_score: 65,
    max_distance_km: 500,
    notification_frequency: 'monthly',
  },
  cache: { cached_matches: 2, best_score: 88.5 },
  dismissals: { total: 4, last_90_days: 1 },
  held_for_approval_count: 1,
  community: COMMUNITY,
  effective: { min_match_score: 65, max_distance_km: 30 },
  needs_coordinator_approval: true,
  findings: ['matching_paused', 'no_location_remote_only', 'needs_coordinator_approval'],
};

const LISTING_DIAGNOSIS: MatchingListingDiagnosis = {
  listing: {
    id: 105,
    title: 'Garden help wanted',
    status: 'paused',
    moderation_status: null,
    type: 'request',
    category_name: 'Gardening',
    service_type: 'physical_only',
    has_coordinates: false,
    created_at: '2026-10-01 10:00:00',
  },
  owner: {
    id: 7,
    name: 'Bob Owner',
    status: 'suspended',
    has_coordinates: false,
    last_active_at: null,
    days_since_active: null,
  },
  cache: { members_cached: 6, best_score: null },
  dismissals: { total: 3 },
  community: COMMUNITY,
  findings: ['listing_not_active', 'listing_not_approved', 'owner_not_active', 'owner_dormant', 'no_location_in_person'],
};

async function engineLoaded() {
  await waitFor(() => {
    expect(
      screen.queryAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true')
    ).toBeUndefined();
  });
}

describe('MatchingDiagnostic — engine status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinner for engine status on mount', () => {
    mockGetMatchingStats.mockReturnValue(new Promise(() => {}));
    render(<MatchingDiagnostic />);

    const statusEls = screen.getAllByRole('status');
    const busyEl = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busyEl).toBeInTheDocument();
  });

  it('reads the three tiles from the names the server really sends', async () => {
    mockGetMatchingStats.mockResolvedValue({ success: true, data: ENGINE_STATS });
    render(<MatchingDiagnostic />);
    await engineLoaded();

    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText(/73\.4%/)).toBeInTheDocument();
    expect(screen.queryByText('--')).not.toBeInTheDocument();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('shows "--" and says so when the stats payload is not usable', async () => {
    mockGetMatchingStats.mockResolvedValue({ success: true, data: {} });
    render(<MatchingDiagnostic />);
    await engineLoaded();

    expect(screen.getAllByText('--').length).toBe(3);
    expect(mockToastError).toHaveBeenCalled();
  });

  it('calls toast.error when engine status fetch fails', async () => {
    mockGetMatchingStats.mockRejectedValue(new Error('500'));
    render(<MatchingDiagnostic />);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
  });
});

describe('MatchingDiagnostic — diagnose user', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMatchingStats.mockResolvedValue({ success: true, data: ENGINE_STATS });
  });

  async function diagnoseUser(id: string) {
    const user = userEvent.setup();
    render(<MatchingDiagnostic />);
    await engineLoaded();

    const userIdInput = screen.getByLabelText(/user id/i);
    await user.click(userIdInput);
    await user.type(userIdInput, id);
    await user.click(screen.getAllByRole('button', { name: /diagnose/i })[0] as HTMLElement);
  }

  it('Diagnose button is disabled when user ID field is empty', async () => {
    render(<MatchingDiagnostic />);
    await engineLoaded();

    const diagnoseButtons = screen.getAllByRole('button', { name: /diagnose/i });
    // First Diagnose button belongs to the user section
    expect(diagnoseButtons[0]).toBeDisabled();
  });

  it('asks about that member and lists what is holding their matches back', async () => {
    mockDiagnoseUser.mockResolvedValue({ success: true, data: USER_DIAGNOSIS });
    await diagnoseUser('42');

    await waitFor(() => expect(mockDiagnoseUser).toHaveBeenCalledWith(42));
    const result = within(await screen.findByTestId('user-diagnosis'));

    expect(result.getByText('This member has paused their own matching.')).toBeInTheDocument();
    expect(
      result.getByText('This member has not set a location, so they are only matched with things that can be done remotely.')
    ).toBeInTheDocument();
    expect(
      result.getByText("A coordinator has to approve this member's matches before anyone is introduced.")
    ).toBeInTheDocument();
    expect(result.queryByText('Nothing is holding matches back.')).not.toBeInTheDocument();
  });

  it('shows the facts as a readable list, not as raw JSON', async () => {
    mockDiagnoseUser.mockResolvedValue({ success: true, data: USER_DIAGNOSIS });
    await diagnoseUser('42');
    const result = within(await screen.findByTestId('user-diagnosis'));

    expect(document.querySelector('pre')).toBeNull();
    expect(result.getByText('Alice Member')).toBeInTheDocument();
    expect(result.getByText('#42')).toBeInTheDocument();
    expect(result.getByText('Account status')).toBeInTheDocument();
    // The stored state in words, never the stored value.
    expect(result.getByText('Active')).toBeInTheDocument();
    expect(result.queryByText('active')).not.toBeInTheDocument();
    expect(result.getByText('server-dt:2026-11-10 09:00:00')).toBeInTheDocument();
    expect(result.getByText('Active offers and requests')).toBeInTheDocument();
    // By type and category, in words.
    expect(result.getByText(/Offer · Gardening ·/)).toBeInTheDocument();
    expect(result.getByText(/Request · No category ·/)).toBeInTheDocument();
    // Their own minimum; the community's 30 km caps their 500.
    expect(result.getByText("65% (the member's own setting)")).toBeInTheDocument();
    expect(result.getByText(/^30\s?km \(the community's setting\)$/)).toBeInTheDocument();
    expect(result.getByText('88.5%')).toBeInTheDocument();
    expect(result.getByText('4 in all, 1 in the last 90 days')).toBeInTheDocument();
    expect(result.getByText('Matches waiting for a coordinator')).toBeInTheDocument();
  });

  it('says so when nothing is in the way', async () => {
    mockDiagnoseUser.mockResolvedValue({
      success: true,
      data: { ...USER_DIAGNOSIS, needs_coordinator_approval: false, findings: ['nothing_blocking'] },
    });
    await diagnoseUser('42');

    expect(await screen.findByText('Nothing is holding matches back.')).toBeInTheDocument();
  });

  it('shows a finding it has no wording for exactly as the server named it', async () => {
    mockDiagnoseUser.mockResolvedValue({
      success: true,
      data: { ...USER_DIAGNOSIS, findings: ['some_future_reason'] },
    });
    await diagnoseUser('42');

    expect(await screen.findByText('some_future_reason')).toBeInTheDocument();
  });

  it('says there is no such member when the id is not in this community', async () => {
    mockDiagnoseUser.mockResolvedValue({ success: false, code: 'NOT_FOUND', error: 'raw server text' });
    await diagnoseUser('99');

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('No diagnostic data found for this user')
    );
    expect(screen.queryByTestId('user-diagnosis')).not.toBeInTheDocument();
  });

  it('says the check failed, in its own words, when the server errors', async () => {
    mockDiagnoseUser.mockResolvedValue({ success: false, code: 'SERVER_ERROR', error: 'SQLSTATE secret detail' });
    await diagnoseUser('99');

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Failed to diagnose user'));
    expect(mockToastError).not.toHaveBeenCalledWith('SQLSTATE secret detail');
  });

  it('refuses a payload that is not a diagnosis instead of rendering it', async () => {
    // What the old endpoint returned for every id: community-wide stats.
    mockDiagnoseUser.mockResolvedValue({ success: true, data: ENGINE_STATS });
    await diagnoseUser('1');

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(screen.queryByTestId('user-diagnosis')).not.toBeInTheDocument();
  });

  it('shows error toast when diagnoseUser fails', async () => {
    mockDiagnoseUser.mockRejectedValue(new Error('network'));
    await diagnoseUser('99');

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
  });
});

describe('MatchingDiagnostic — diagnose listing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMatchingStats.mockResolvedValue({ success: true, data: ENGINE_STATS });
  });

  async function diagnoseListing(id: string) {
    const user = userEvent.setup();
    render(<MatchingDiagnostic />);
    await engineLoaded();

    const listingIdInput = screen.getByLabelText(/listing id/i);
    await user.click(listingIdInput);
    await user.type(listingIdInput, id);
    await user.click(screen.getAllByRole('button', { name: /diagnose/i })[1] as HTMLElement);
  }

  it('Diagnose button for listing is disabled when listing ID is empty', async () => {
    render(<MatchingDiagnostic />);
    await engineLoaded();

    const diagnoseButtons = screen.getAllByRole('button', { name: /diagnose/i });
    // Second button belongs to listing section
    expect(diagnoseButtons[1]).toBeDisabled();
  });

  it('asks about that listing and explains why it is not being offered', async () => {
    mockDiagnoseListing.mockResolvedValue({ success: true, data: LISTING_DIAGNOSIS });
    await diagnoseListing('105');

    await waitFor(() => expect(mockDiagnoseListing).toHaveBeenCalledWith(105));
    const result = within(await screen.findByTestId('listing-diagnosis'));

    expect(result.getByText('This listing is not active, so it is not offered as a match.')).toBeInTheDocument();
    expect(
      result.getByText('The member who posted this does not have an active account, so the listing is not offered as a match.')
    ).toBeInTheDocument();
    expect(
      result.getByText('This listing is waiting for review or was not approved, so it is not offered as a match.')
    ).toBeInTheDocument();
    // The community's own dormancy setting is named in the sentence.
    expect(
      result.getByText('The member who posted this has not been active for more than 90 days, so the listing is not offered as a match.')
    ).toBeInTheDocument();
    expect(
      result.getByText(/This is an in-person listing and neither it nor its owner has a location/)
    ).toBeInTheDocument();
  });

  it('shows the listing and its owner as readable facts', async () => {
    mockDiagnoseListing.mockResolvedValue({ success: true, data: LISTING_DIAGNOSIS });
    await diagnoseListing('105');
    const result = within(await screen.findByTestId('listing-diagnosis'));

    expect(document.querySelector('pre')).toBeNull();
    expect(result.getByText('Garden help wanted')).toBeInTheDocument();
    expect(result.getByText('#105')).toBeInTheDocument();
    // States and delivery in words, never the stored values.
    expect(result.getByText('Paused')).toBeInTheDocument();
    expect(result.getByText('In-person only')).toBeInTheDocument();
    expect(result.getByText('Request')).toBeInTheDocument();
    expect(result.getByText('Gardening')).toBeInTheDocument();
    expect(result.getByText('Bob Owner')).toBeInTheDocument();
    expect(result.getByText('Suspended')).toBeInTheDocument();
    expect(result.queryByText('physical_only')).not.toBeInTheDocument();
    expect(result.queryByText('suspended')).not.toBeInTheDocument();
    expect(result.getByText('Members it is matched with now')).toBeInTheDocument();
    // Moderation, owner's last activity and best score were never recorded.
    expect(result.getAllByText('Not recorded').length).toBe(3);
  });

  it('says there is no such listing when the id is not in this community', async () => {
    mockDiagnoseListing.mockResolvedValue({ success: false, code: 'NOT_FOUND', error: 'raw server text' });
    await diagnoseListing('9');

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('No diagnostic data found for this listing')
    );
    expect(screen.queryByTestId('listing-diagnosis')).not.toBeInTheDocument();
  });

  it('puts an unfamiliar stored state as "Unknown" rather than printing it', async () => {
    mockDiagnoseListing.mockResolvedValue({
      success: true,
      data: {
        ...LISTING_DIAGNOSIS,
        listing: { ...LISTING_DIAGNOSIS.listing, status: 'archived_v9', service_type: 'teleport' },
      },
    });
    await diagnoseListing('105');
    const result = within(await screen.findByTestId('listing-diagnosis'));

    expect(result.getAllByText('Unknown').length).toBe(2);
    expect(result.queryByText('archived_v9')).not.toBeInTheDocument();
    expect(result.queryByText('teleport')).not.toBeInTheDocument();
  });
});
