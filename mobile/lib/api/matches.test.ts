// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { dismissMatch, getMatches } from './matches';

jest.mock('@/lib/api/client', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
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

    expect(api.get).toHaveBeenCalledWith('/api/v2/matches/all');
    expect(result.data).toHaveLength(1);
    const match = result.data[0];
    expect(match.source_type).toBe('listing');
    expect(match.source_id).toBe(529);
    expect(match.reasons).toEqual(['Same category: Home and Garden', 'Posted recently']);
    expect(match.matched_user).toEqual({ id: 674, name: 'E2E UserA', avatar_url: null });
    expect(match.matched_at).toBe('2026-08-22 09:36:47');
    expect(match.metadata?.category).toBe('Home and Garden');
    // The screen keys its list and its dismissals on this, so it must exist.
    expect(Number.isFinite(match.id)).toBe(true);
  });

  it('reads the module-specific id field for volunteering and events', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        matches: [
          { module: 'volunteering', organization_id: 109, title: 'Riverside Community Garden', match_score: 35, match_reasons: ['Matches your profile'], created_at: '2026-08-23 09:00:00' },
          { module: 'event', event_id: 164, title: 'OfflineQueueWalk', match_score: 30, match_reasons: [], created_at: '2026-08-23 10:00:00' },
        ],
      },
    });

    const result = await getMatches();

    expect(result.data.map((m) => [m.source_type, m.source_id])).toEqual([
      ['volunteering', 109],
      ['event', 164],
    ]);
    // No user on these modules — the screen must get null, not undefined.
    expect(result.data[0].matched_user).toBeNull();
  });

  it('falls back rather than crashing on a module the app does not know', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: { matches: [{ module: 'something_new', title: 'Unknown', match_score: 10 }] },
    });

    const result = await getMatches();

    // A new module server-side must not take the whole screen down again.
    expect(result.data[0].source_type).toBe('listing');
    expect(result.data[0].reasons).toEqual([]);
  });

  it('gives every match a distinct stable id', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        matches: [
          { module: 'listing', listing_id: 7, title: 'A', match_score: 1 },
          { module: 'volunteering', organization_id: 7, title: 'B', match_score: 1 },
        ],
      },
    });

    const result = await getMatches();

    // Same numeric source id in two modules must not collide — the screen tracks
    // dismissals by this value.
    expect(result.data[0].id).not.toBe(result.data[1].id);
  });

  it('dismisses a listing match with the same not-relevant reason used by web', async () => {
    (api.post as jest.Mock).mockResolvedValue({});

    await dismissMatch(10);

    expect(api.post).toHaveBeenCalledWith('/api/v2/matches/10/dismiss', { reason: 'not_relevant' });
  });
});
