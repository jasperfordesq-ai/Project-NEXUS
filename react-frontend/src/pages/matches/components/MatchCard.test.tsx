// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for MatchCard — one card per kind of match the server can return,
 * each with the right link, the right wording and honest button states.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import React from 'react';

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
  },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/helpers')>()),
  resolveAvatarUrl: (url: string | null) => url || '/default-avatar.png',
  formatRelativeTime: (d: string) => d,
}));

const stableToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const stableTenant = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
  tenantPath: (p: string) => `/test${p}`,
  hasFeature: vi.fn(() => true),
  hasModule: vi.fn(() => true),
};

vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => stableTenant),
  useToast: vi.fn(() => stableToast),
}));

vi.mock('@/hooks', () => ({ useMediaQuery: vi.fn(() => true) }));

vi.mock('@/lib/motion', () => {
  const motionProps = new Set(['variants', 'initial', 'animate', 'layout', 'transition', 'exit']);
  return {
    motion: {
      div: ({ children, ...props }: Record<string, unknown>) => {
        const rest: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(props)) { if (!motionProps.has(k)) rest[k] = v; }
        return <div {...rest}>{children as React.ReactNode}</div>;
      },
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

import { MatchCard } from './MatchCard';
import type { Match } from '../types';

const listing: Match = {
  module: 'listing',
  listing_id: 10,
  title: 'Gardening help',
  match_score: 72.6,
  match_type: 'one_way',
  match_reasons: ['Skill match'],
  user_id: 5,
  user_name: 'Jane',
};

function renderCard(match: Match, onDismissed = vi.fn()) {
  render(<MatchCard match={match} index={0} onDismissed={onDismissed} />);
  return onDismissed;
}

describe('MatchCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('where a card leads', () => {
    it('opens a volunteering match by its opportunity id, never the organisation id', () => {
      // Regression: the card used to build /volunteering/opportunities/{organization_id},
      // which opened an unrelated opportunity (or "not found").
      renderCard({
        module: 'volunteering',
        opportunity_id: 31,
        organization_id: 109,
        organization_name: 'Riverside Community Garden',
        location: 'Cork',
        title: 'Weekend planting',
        match_score: 40,
        match_type: 'volunteering_recommendation',
      });

      const link = screen.getByRole('link', { name: /Weekend planting/ });
      expect(link).toHaveAttribute('href', '/test/volunteering/opportunities/31');
      expect(screen.getByText('Riverside Community Garden')).toBeInTheDocument();
      expect(screen.getByText('Cork')).toBeInTheDocument();
    });

    it('shows a volunteering match with no opportunity id as a card without a link', () => {
      // An older server sends only organization_id. No link is better than a wrong one.
      renderCard({
        module: 'volunteering',
        organization_id: 109,
        title: 'Riverside Community Garden',
        match_score: 35,
      });

      expect(screen.getByText('Riverside Community Garden')).toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('gives an event its own card: link, start time, place and who is going', () => {
      renderCard({
        module: 'event',
        event_id: 164,
        title: 'Repair café',
        event_date: '2026-12-05 14:00:00',
        location: 'Town Hall',
        attendee_count: 7,
        match_score: 60,
        match_type: 'event_recommendation',
      });

      expect(screen.getByRole('link', { name: /Repair café/ })).toHaveAttribute('href', '/test/events/164');
      expect(screen.getByText('Event')).toBeInTheDocument();
      expect(screen.getByText('Town Hall')).toBeInTheDocument();
      expect(screen.getByText('Going: 7')).toBeInTheDocument();
      // The start time is shown in the reader's format; the year is always in it.
      expect(screen.getByText(/2026/)).toBeInTheDocument();
      // Events cannot be hidden server-side, so no button offers to.
      expect(screen.queryByRole('button', { name: 'Not interested' })).not.toBeInTheDocument();
    });

    it('keeps the "+N more" button out of the card link', () => {
      // A button inside a link is invalid, and pressing it could follow the link.
      renderCard({ ...listing, match_reasons: ['One', 'Two', 'Three', 'Four', 'Five'] });

      const more = screen.getByRole('button', { name: /\+2 more/ });
      expect(more.closest('a')).toBeNull();
    });
  });

  describe('how a match is described', () => {
    it('shows the score as a whole number', () => {
      renderCard(listing);
      expect(screen.getByText('73% match')).toBeInTheDocument();
      expect(screen.queryByText(/72\.6/)).not.toBeInTheDocument();
    });

    it('labels a cold-start item as a suggestion instead of giving it a match score', () => {
      renderCard({ ...listing, match_type: 'cold_start', match_score: 45 });

      expect(screen.getByText('Suggested for you')).toBeInTheDocument();
      expect(screen.queryByText(/% match/)).not.toBeInTheDocument();
    });
  });

  describe('joining a group', () => {
    const group: Match = { module: 'group', group_id: 8, title: 'Walkers', match_score: 55, visibility: 'private' };

    it('says "Request sent" when the group answers that the request is pending', async () => {
      mockApiPost.mockResolvedValue({ success: true, data: { status: 'pending' } });
      renderCard(group);

      fireEvent.click(screen.getByRole('button', { name: 'Join' }));

      expect(await screen.findByText('Request sent')).toBeInTheDocument();
      expect(screen.queryByText('Joined')).not.toBeInTheDocument();
      expect(mockApiPost).toHaveBeenCalledWith('/v2/groups/8/join', {});
      expect(stableToast.success).toHaveBeenCalledWith("We've sent your request to join. The group will let you know.");
    });

    it('says "Joined" only when the member is really in the group', async () => {
      mockApiPost.mockResolvedValue({ success: true, data: { status: 'active' } });
      renderCard(group);

      fireEvent.click(screen.getByRole('button', { name: 'Join' }));

      expect(await screen.findByText('Joined')).toBeInTheDocument();
      expect(screen.queryByText('Request sent')).not.toBeInTheDocument();
    });

    it('explains a failed join in its own words', async () => {
      mockApiPost.mockResolvedValue({ success: false });
      renderCard(group);

      fireEvent.click(screen.getByRole('button', { name: 'Join' }));

      await waitFor(() => expect(stableToast.error).toHaveBeenCalledWith(
        "We couldn't add you to that group. Please try again.",
      ));
    });
  });

  describe('messaging the member who posted', () => {
    afterEach(() => {
      stableTenant.hasFeature.mockImplementation(() => true);
      stableTenant.hasModule.mockImplementation(() => true);
    });

    it('offers Message where the community allows members to message each other', () => {
      renderCard(listing);

      expect(screen.getByRole('link', { name: 'Message' })).toBeInTheDocument();
    });

    it('does not offer Message where direct messaging is switched off', () => {
      // The listing page hides it too; here it led to a redirect.
      stableTenant.hasFeature.mockImplementation((feature?: string) => feature !== 'direct_messaging');
      renderCard(listing);

      expect(screen.queryByRole('link', { name: 'Message' })).not.toBeInTheDocument();
    });

    it('does not offer Message where the community has no messages at all', () => {
      stableTenant.hasModule.mockImplementation((module?: string) => module !== 'messages');
      renderCard(listing);

      expect(screen.queryByRole('link', { name: 'Message' })).not.toBeInTheDocument();
    });
  });

  describe('saving an offer or request', () => {
    it('does not remove something the member had already saved', async () => {
      // POST /v2/bookmarks is a toggle: pressed blind, the first press on an
      // already-saved item would have removed it while showing "saved".
      mockApiGet.mockResolvedValue({ success: true, data: { bookmarked: true, count: 1 } });
      renderCard(listing);

      const save = screen.getByRole('button', { name: 'Save match' });
      expect(save).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(save);

      await waitFor(() => expect(save).toHaveAttribute('aria-pressed', 'true'));
      expect(mockApiGet).toHaveBeenCalledWith('/v2/bookmarks/status?type=listing&id=10');
      expect(mockApiPost).not.toHaveBeenCalled();
      expect(stableToast.info).toHaveBeenCalledWith("You've already saved this one");
    });

    it('saves when it was not saved, and takes the state from the server answer', async () => {
      mockApiGet.mockResolvedValue({ success: true, data: { bookmarked: false, count: 0 } });
      mockApiPost.mockResolvedValue({ success: true, data: { bookmarked: true, count: 1 } });
      renderCard(listing);

      const save = screen.getByRole('button', { name: 'Save match' });
      fireEvent.click(save);

      await waitFor(() => expect(save).toHaveAttribute('aria-pressed', 'true'));
      expect(mockApiPost).toHaveBeenCalledWith('/v2/bookmarks', { type: 'listing', id: 10 });
      expect(stableToast.success).toHaveBeenCalledWith('Saved for later');
    });

    it('shows "not saved" when the server says the press removed it', async () => {
      mockApiGet.mockResolvedValue({ success: true, data: { bookmarked: false, count: 0 } });
      mockApiPost
        .mockResolvedValueOnce({ success: true, data: { bookmarked: true, count: 1 } })
        .mockResolvedValueOnce({ success: true, data: { bookmarked: false, count: 0 } });
      renderCard(listing);

      const save = screen.getByRole('button', { name: 'Save match' });
      fireEvent.click(save);
      await waitFor(() => expect(save).toHaveAttribute('aria-pressed', 'true'));

      fireEvent.click(save);
      await waitFor(() => expect(save).toHaveAttribute('aria-pressed', 'false'));
      // Known after the first press, so the status is not asked for again.
      expect(mockApiGet).toHaveBeenCalledTimes(1);
      expect(stableToast.success).toHaveBeenLastCalledWith('Removed from your saved items');
    });

    it('changes nothing, and says so, when the saved state cannot be checked', async () => {
      mockApiGet.mockResolvedValue({ success: false });
      renderCard(listing);

      const save = screen.getByRole('button', { name: 'Save match' });
      fireEvent.click(save);

      await waitFor(() => expect(stableToast.error).toHaveBeenCalledWith(
        "We couldn't save that just now. Please try again.",
      ));
      expect(mockApiPost).not.toHaveBeenCalled();
      expect(save).toHaveAttribute('aria-pressed', 'false');
    });
  });

  describe('hiding a match', () => {
    it('hides a group match through the typed endpoint', async () => {
      mockApiPost.mockResolvedValue({ success: true });
      const onDismissed = renderCard({ module: 'group', group_id: 8, title: 'Walkers', match_score: 55 });

      fireEvent.click(screen.getByRole('button', { name: 'Not interested' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Too far away' }));

      await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/v2/matches/group/8/dismiss', { reason: 'too_far' }));
      await waitFor(() => expect(onDismissed).toHaveBeenCalled());
    });

    it('explains a failed hide in its own words, not as a page that did not load', async () => {
      mockApiPost.mockResolvedValue({ success: false });
      const onDismissed = renderCard(listing);

      fireEvent.click(screen.getByRole('button', { name: 'Not interested' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Too far away' }));

      await waitFor(() => expect(stableToast.error).toHaveBeenCalledWith(
        "We couldn't hide that match. Please try again.",
      ));
      expect(onDismissed).not.toHaveBeenCalled();
    });
  });
});
