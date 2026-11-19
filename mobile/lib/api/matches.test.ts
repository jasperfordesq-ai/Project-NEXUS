// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { dismissMatch, getMatchPreferences, getMatches, updateMatchPreferences } from './matches';

jest.mock('@/lib/api/client', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
  },
}));

describe('matches API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * 🔴 This fixture used to be written in the app's OWN vocabulary — `source_type`,
   * `source_id`, `reasons`, `matched_at` — none of which the server sends. It passed while
   * the Matches screen crashed on real data with "Cannot read property 'tone' of
   * undefined", because `SOURCE_CONFIG[item.source_type]` was undefined for every match.
   * Measured on a device 2026-08-23. Third fixture today written from the client type
   * instead of the response.
   *
   * These payloads are copied from `GET /v2/matches/all` as it actually answers
   * (`CrossModuleMatchingService`): `module`, a module-specific id field, `match_reasons`,
   * `created_at`, and `user_name`/`avatar_url` on listings only.
   */
  it('normalises the listing shape the server actually sends', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        matches: [
          {
            module: 'listing',
            listing_id: 529,
            title: 'Help putting up shelves',
            description: 'Two shelves in the kitchen.',
            type: 'request',
            category_name: 'Home and Garden',
            user_id: 674,
            user_name: 'E2E UserA',
            avatar_url: null,
            match_score: 48.4,
            match_type: 'potential',
            match_reasons: ['Same category: Home and Garden', 'Posted recently'],
            created_at: '2026-08-22 09:36:47',
          },
        ],
      },
    });

    const result = await getMatches();

    expect(api.get).toHaveBeenCalledWith('/api/v2/matches/all?limit=50');
    expect(result.data).toHaveLength(1);
    const match = result.data[0];
    expect(match.source_type).toBe('listing');
    expect(match.source_id).toBe(529);
    expect(match.match_type).toBe('potential');
    expect(match.reasons).toEqual(['Same category: Home and Garden', 'Posted recently']);
    expect(match.matched_user).toEqual({ id: 674, name: 'E2E UserA', avatar_url: null });
    expect(match.matched_at).toBe('2026-08-22 09:36:47');
    expect(match.metadata?.category).toBe('Home and Garden');
    // The screen keys its list and its dismissals on this, so it must exist.
    expect(match.key).toBe('listing-529');
  });

  /**
   * 🔴 The meta block is the server's explanation for an empty list, and this client used to
   * drop it. Copied from the live answer on 2026-08-24, where the fixture member had no
   * coordinates and therefore no listing matches at all: the engine's geographic gate cannot
   * consider a physical listing without an area, and the screen said "No matches yet".
   */
  it('carries the reason an empty list is empty', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        matches: [],
        meta: {
          total: 0,
          modules: ['listings', 'groups', 'volunteering', 'events'],
          min_score: 1,
          needs_location: true,
          degraded: true,
          degraded_reason: 'no_coordinates',
          has_active_listings: true,
          paused: false,
        },
      },
    });

    const result = await getMatches();

    expect(result.data).toEqual([]);
    expect(result.meta).toEqual({
      needsLocation: true,
      degraded: true,
      degradedReason: 'no_coordinates',
      hasActiveListings: true,
      paused: false,
      disabled: false,
    });
  });

  it('carries the safeguarding reason and a community that has matching switched off', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        matches: [],
        meta: { degraded: true, degraded_reason: 'safeguarding_policy_unavailable', disabled: true },
      },
    });

    const result = await getMatches();

    expect(result.meta.degradedReason).toBe('safeguarding_policy_unavailable');
    expect(result.meta.disabled).toBe(true);
  });

  it('never sends a min_score, so the saved minimum is the one applied', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: { matches: [] } });

    await getMatches();

    // Sending one would override the minimum match quality chosen in preferences.
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/api/v2/matches/all?limit=50');
  });

  it('treats an absent meta block as "nothing to explain", never as bad news', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: { matches: [] } });

    const result = await getMatches();

    // hasActiveListings must default TRUE: reading silence as "you have no listings" would
    // show the member a reason the server never gave.
    expect(result.meta).toEqual({
      needsLocation: false,
      degraded: false,
      degradedReason: null,
      hasActiveListings: true,
      paused: false,
      disabled: false,
    });
  });

  /**
   * Each module has its own id field, and the id must be read from THAT field. Reading
   * "whichever id is present" is how a volunteering match came to be opened with the
   * organisation's id (an unrelated opportunity) and how every group match got id 0
   * (`group_id` was not read at all).
   */
  it('reads the id from the field that belongs to each module', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        matches: [
          { module: 'volunteering', opportunity_id: 31, organization_id: 109, organization_name: 'Riverside Community Garden', location: 'Cork', title: 'Weekend planting', match_score: 35, match_type: 'volunteering_recommendation', match_reasons: ['Matches your profile'], created_at: '2026-08-23 09:00:00' },
          { module: 'event', event_id: 164, event_date: '2026-12-05 14:00:00', location: 'Town Hall', attendee_count: 7, title: 'Repair morning', match_score: 30, match_type: 'event_recommendation', match_reasons: [], created_at: '2026-08-23 10:00:00' },
          { module: 'group', group_id: 8, title: 'Walkers', match_score: 55, match_type: 'group_recommendation', match_reasons: [], created_at: '2026-08-23 11:00:00' },
        ],
      },
    });

    const result = await getMatches();

    expect(result.data.map((m) => [m.source_type, m.source_id, m.key])).toEqual([
      ['volunteering', 31, 'volunteering-31'],
      ['event', 164, 'event-164'],
      ['group', 8, 'group-8'],
    ]);
    // No user on these modules — the screen must get null, not undefined.
    expect(result.data[0].matched_user).toBeNull();
    expect(result.data[0].metadata).toMatchObject({ organization_name: 'Riverside Community Garden', location: 'Cork' });
    expect(result.data[1].metadata).toMatchObject({ event_date: '2026-12-05 14:00:00', location: 'Town Hall', attendee_count: 7 });
  });

  it('gives a volunteering match with no opportunity id no id at all, never the organisation id', async () => {
    // What an older server sends. An organisation id is not an opportunity id: used as
    // one, it opens an unrelated opportunity. No link is better than a wrong one.
    (api.get as jest.Mock).mockResolvedValue({
      data: { matches: [{ module: 'volunteering', organization_id: 109, title: 'Riverside Community Garden', match_score: 35 }] },
    });

    const result = await getMatches();

    expect(result.data[0].source_type).toBe('volunteering');
    expect(result.data[0].source_id).toBeNull();
  });

  it('gives each of several group matches its own id and key', async () => {
    // Regression: `group_id` was not read, so every group match had id 0 and one shared key.
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        matches: [
          { module: 'group', group_id: 8, title: 'Walkers', match_score: 55 },
          { module: 'group', group_id: 9, title: 'Gardeners', match_score: 50 },
        ],
      },
    });

    const result = await getMatches();

    expect(result.data.map((m) => m.source_id)).toEqual([8, 9]);
    expect(new Set(result.data.map((m) => m.key)).size).toBe(2);
  });

  it('falls back rather than crashing on a module the app does not know', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: { matches: [{ module: 'something_new', title: 'Unknown', match_score: 10 }] },
    });

    const result = await getMatches();

    // A new module server-side must not take the whole screen down again.
    expect(result.data[0].source_type).toBe('listing');
    expect(result.data[0].reasons).toEqual([]);
    // It carries no listing id, so it must not be openable as listing 0.
    expect(result.data[0].source_id).toBeNull();
  });

  it('gives every match a distinct stable key', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        matches: [
          { module: 'listing', listing_id: 7, title: 'A', match_score: 1 },
          { module: 'volunteering', opportunity_id: 7, title: 'B', match_score: 1 },
          { module: 'volunteering', organization_id: 3, title: 'C', match_score: 1 },
          { module: 'volunteering', organization_id: 4, title: 'D', match_score: 1 },
        ],
      },
    });

    const result = await getMatches();

    // Same numeric id in two modules must not collide, and neither must two matches the
    // server sent without an id — the screen keys its list and tracks dismissals by this.
    expect(new Set(result.data.map((m) => m.key)).size).toBe(4);
    expect(result.data[0].key).toBe('listing-7');
    expect(result.data[1].key).toBe('volunteering-7');
  });

  it('dismisses a listing match with the same not-relevant reason used by web', async () => {
    (api.post as jest.Mock).mockResolvedValue({});

    await dismissMatch(10);

    expect(api.post).toHaveBeenCalledWith('/api/v2/matches/10/dismiss', { reason: 'not_relevant' });
  });

  it('loads match preferences with safe defaults for fields omitted by the server', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        max_distance_km: 40,
        categories: [3, 7],
        matching_paused: true,
      },
    });

    await expect(getMatchPreferences()).resolves.toEqual({
      max_distance_km: 40,
      min_match_score: 50,
      notification_frequency: 'monthly',
      notify_hot_matches: true,
      notify_mutual_matches: true,
      matching_paused: true,
      categories: [3, 7],
      availability: [],
      // Not stated by the server, so the slider falls back to 100 km.
      max_distance_limit_km: 100,
    });
    expect(api.get).toHaveBeenCalledWith('/api/v2/users/me/match-preferences');
  });

  it('reads the distance limit of the community and never shows a distance beyond it', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: { max_distance_km: 80, max_distance_limit_km: 50 },
    });

    const preferences = await getMatchPreferences();

    expect(preferences.max_distance_limit_km).toBe(50);
    expect(preferences.max_distance_km).toBe(50);
  });

  it('persists the complete match-preferences payload and returns the saved state', async () => {
    const preferences = {
      max_distance_km: 15,
      min_match_score: 65,
      notification_frequency: 'fortnightly' as const,
      notify_hot_matches: false,
      notify_mutual_matches: true,
      matching_paused: false,
      categories: [4],
      availability: [],
    };
    (api.put as jest.Mock).mockResolvedValue({ data: { ...preferences, max_distance_limit_km: 50 } });

    await expect(updateMatchPreferences({ ...preferences, max_distance_limit_km: 50 }))
      .resolves.toEqual({ ...preferences, max_distance_limit_km: 50 });
    // The community's limit is read-only: it is never sent back.
    expect(api.put).toHaveBeenCalledWith('/api/v2/users/me/match-preferences', preferences);
  });

  it('returns the value the server kept, not the one that was sent', async () => {
    const editable = {
      max_distance_km: 75,
      min_match_score: 65,
      notification_frequency: 'monthly' as const,
      notify_hot_matches: true,
      notify_mutual_matches: true,
      matching_paused: false,
      categories: [],
      availability: [],
    };
    // An older server that does not restate the limit has not changed it.
    (api.put as jest.Mock).mockResolvedValue({ data: { ...editable, max_distance_km: 60 } });

    const saved = await updateMatchPreferences({ ...editable, max_distance_limit_km: 80 });

    expect(saved.max_distance_km).toBe(60);
    expect(saved.max_distance_limit_km).toBe(80);
  });
});
