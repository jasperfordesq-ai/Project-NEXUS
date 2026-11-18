// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The match debug panel must show the breakdown the server really sends.
 *
 * It used to read `_debug_scores`, `reasons`, `matched_user`, `category` and
 * `source_type` — none of which GET /v2/matches/all?debug=true has ever
 * returned — so every card showed a title, a score and "No debug scores
 * available". These tests drive the whole journey: search a member, pick
 * them, read their matches.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const { mockApi, mockAdminUsers, mockToast } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  mockAdminUsers: { list: vi.fn() },
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/admin/api/adminApi', () => ({ adminUsers: mockAdminUsers }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (u: string | null | undefined) => u ?? '',
}));
vi.mock('@/contexts', () => createMockContexts({ useToast: () => mockToast }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

function adminComponentsMock() {
  return {
    PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
      <div data-testid="page-header">{title}{actions}</div>
    ),
  };
}
vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);

import { MatchDebugPanel } from './MatchDebugPanel';

const MEMBER = { id: 5, name: 'Alice Jones', email: 'alice@example.com', avatar_url: null };

/** A listing match from the current scoring method, as CrossModuleMatchingService sends it. */
const LISTING_MATCH = {
  module: 'listing',
  listing_id: 10,
  title: 'Gardening Help',
  description: 'Need someone to help in the garden',
  type: 'request',
  category_name: 'Outdoors',
  user_id: 9,
  user_name: 'Bob Owner',
  avatar_url: null,
  match_score: 82.4,
  match_type: 'mutual',
  match_reasons: ['Same category: Outdoors', 'Mutual exchange possible!'],
  distance_km: 3.25,
  matched_listing: 'Lawn mowing offered',
  score_breakdown: {
    pillars: { relevance: 0.91, feasibility: 0.6, trust: 0.33 },
    signals: {
      relevance: { category: 1, skill: 0.8, semantic: 0.75 },
      feasibility: { proximity: 0.9, availability: 0.5, activity: 0.4 },
      trust: { reviews: 0.2, trust_tier: 0.5, completion: 0.3 },
    },
    adjustments: { mutual: 8, freshness: 2.5, dismissal_penalty: -3 },
  },
  match_breakdown: {
    relevance: { category: 1, skill: 0.8, semantic: 0.75 },
    feasibility: { proximity: 0.9, availability: 0.5, activity: 0.4 },
    trust: { reviews: 0.2, trust_tier: 0.5, completion: 0.3 },
  },
};

/** The older scoring method: no pillars, six flat 0–1 scores. */
const LEGACY_MATCH = {
  module: 'listing',
  listing_id: 11,
  title: 'Bike repair',
  user_name: 'Cara Fixer',
  match_score: 55,
  match_reasons: [],
  distance_km: null,
  score_breakdown: null,
  match_breakdown: { category: 0.9, skill: 0.85, proximity: 0.7, freshness: 0.8, reciprocity: 0.6, quality: 0.75 },
};

const EVENT_MATCH = {
  module: 'event',
  event_id: 3,
  title: 'Repair café',
  match_score: 40,
  match_type: 'event_recommendation',
  match_reasons: ['Upcoming event that matches your interests'],
  distance_km: null,
};

/** Search for the member, pick them, and wait for their matches to be asked for. */
async function inspect(matchesResponse: unknown) {
  mockAdminUsers.list.mockResolvedValue({ success: true, data: [MEMBER] });
  mockApi.get.mockResolvedValue(matchesResponse);
  render(<MatchDebugPanel />);

  const input = document.querySelector('input[name="admin-search"]') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'alice' } });
  // The search is debounced by 350 ms.
  const option = await screen.findByText('alice@example.com', {}, { timeout: 3000 });
  fireEvent.click(option.closest('button') as HTMLElement);

  await waitFor(() =>
    expect(mockApi.get).toHaveBeenCalledWith('/v2/matches/all?limit=10&debug=true&user_id=5')
  );
}

describe('MatchDebugPanel — the breakdown the server sends', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('shows the three pillars, the signals inside each and the later adjustments', async () => {
    await inspect({ success: true, data: { matches: [LISTING_MATCH], meta: { total: 1 } } });

    expect(await screen.findByText('Gardening Help')).toBeInTheDocument();
    expect(screen.queryByText('No debug scores available')).not.toBeInTheDocument();

    // Pillars (0–1 on the wire, whole percentages on screen)
    for (const [label, value] of [['Relevance', '91'], ['Feasibility', '60'], ['Trust', '33']] as const) {
      const row = screen.getByText(label).parentElement as HTMLElement;
      expect(within(row).getByText(value)).toBeInTheDocument();
    }
    // Signals
    for (const label of [
      'Category Match', 'Skill Match', 'Description similarity',
      'Proximity', 'Availability', 'Activity level',
      'Reviews', 'Trust tier', 'Completion rate',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Adjustments, signed, by the engine's own name
    expect(screen.getByText('Points added or taken off afterwards')).toBeInTheDocument();
    expect(within(screen.getByText('mutual').closest('li') as HTMLElement).getByText('+8')).toBeInTheDocument();
    expect(within(screen.getByText('dismissal_penalty').closest('li') as HTMLElement).getByText('-3')).toBeInTheDocument();
  });

  it('shows who posted it, the category, the distance, what it was matched against and the reasons', async () => {
    await inspect({ success: true, data: { matches: [LISTING_MATCH], meta: { total: 1 } } });

    expect(await screen.findByText('Bob Owner')).toBeInTheDocument();
    expect(screen.getByText('Outdoors')).toBeInTheDocument();
    expect(screen.getByText('Listing')).toBeInTheDocument();
    expect(screen.getByText(/^3\.3\s?km$/)).toBeInTheDocument();
    expect(screen.getByText('Matched against their listing: Lawn mowing offered')).toBeInTheDocument();
    expect(screen.getByText('Same category: Outdoors')).toBeInTheDocument();
    expect(screen.getByText('Mutual exchange possible!')).toBeInTheDocument();
    // The score is rounded for display.
    expect(screen.getByText('82')).toBeInTheDocument();
  });

  it('shows the six flat scores for a match from the older scoring method', async () => {
    await inspect({ success: true, data: { matches: [LEGACY_MATCH], meta: { total: 1 } } });

    expect(await screen.findByText('Bike repair')).toBeInTheDocument();
    for (const [label, value] of [
      ['Category Match', '90'], ['Skill Match', '85'], ['Proximity', '70'],
      ['Freshness', '80'], ['Reciprocity', '60'], ['Quality', '75'],
    ] as const) {
      const row = screen.getByText(label).parentElement as HTMLElement;
      expect(within(row).getByText(value)).toBeInTheDocument();
    }
    expect(screen.queryByText('Relevance')).not.toBeInTheDocument();
    expect(screen.queryByText('No debug scores available')).not.toBeInTheDocument();
  });

  it('says that an event, group or volunteering suggestion has no breakdown', async () => {
    await inspect({ success: true, data: { matches: [EVENT_MATCH], meta: { total: 1 } } });

    expect(await screen.findByText('Repair café')).toBeInTheDocument();
    expect(screen.getByText('Event')).toBeInTheDocument();
    expect(screen.getByText('This kind of suggestion has no score breakdown.')).toBeInTheDocument();
    expect(screen.queryByText('No debug scores available')).not.toBeInTheDocument();
  });

  it('says a listing match has no scores only when it really carries none', async () => {
    await inspect({
      success: true,
      data: { matches: [{ ...LEGACY_MATCH, match_breakdown: undefined }], meta: { total: 1 } },
    });

    expect(await screen.findByText('No debug scores available')).toBeInTheDocument();
  });

  it('shows a refusal as an error, not as "this member has no matches" in silence', async () => {
    await inspect({ success: false, error: 'Member not found', code: 'NOT_FOUND' });

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith('Failed to load matches for this user')
    );
    expect(mockToast.error).not.toHaveBeenCalledWith('Member not found');
  });
});
