// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Owner, 31 Oct 2026: a group's own name and description must be translatable,
 * not only its discussions. One Translate press translates both.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// pages/groups keeps direct client imports to an allowlist, so the client is
// mocked without importing it.
const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: mockPost, put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() }),
  })
);

vi.mock('@/components/location/LocationMapCard', () => ({
  LocationMapCard: () => <div data-testid="location-map" />,
}));

import type { Group } from '@/types/api';
import { GroupHeader, type JoinRequest } from './GroupHeader';

const group = {
  id: 7,
  name: 'Vecinos solidarios',
  description: 'Un grupo de ayuda local',
  visibility: 'public',
  status: 'active',
  cover_image_url: null,
  cover_image: null,
  image_url: null,
  location: null,
  latitude: null,
  longitude: null,
  members_count: 12,
  posts_count: 7,
  created_at: '2026-01-15T00:00:00Z',
} as unknown as Group;

const props = {
  group,
  userIsMember: false,
  userIsAdmin: false,
  isAuthenticated: true,
  isJoining: false,
  isPrivateGroup: false,
  joinRequests: [] as JoinRequest[],
  requestsLoading: false,
  requestsLoaded: false,
  processingRequest: null,
  getMemberCount: (g: Group) => g.members_count ?? 0,
  onJoinLeave: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenDelete: vi.fn(),
  onOpenInvite: vi.fn(),
  onOpenNotifPrefs: vi.fn(),
  onLoadJoinRequests: vi.fn(),
  onJoinRequest: vi.fn(),
};

const translations: Record<string, string> = {
  group: 'A local help group',
  group_name: 'Neighbours who help',
};

describe('GroupHeader — Translate the group name and description', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPost.mockImplementation((_url: string, body: { content_type: string }) => Promise.resolve({
      success: true,
      data: { translated_text: translations[body.content_type], source_locale: 'es', target_locale: 'en', cached: false },
    }));
  });

  it('translates name and description together and restores the originals', async () => {
    render(<GroupHeader {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /^translate/i }));

    expect(await screen.findByText('A local help group')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Neighbours who help');
    expect(mockPost).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'group', content_id: 7, source_text: 'Un grupo de ayuda local',
    }));
    expect(mockPost).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'group_name', content_id: 7, source_text: 'Vecinos solidarios',
    }));

    fireEvent.click(screen.getByRole('button', { name: /show original/i }));
    expect(await screen.findByText('Un grupo de ayuda local')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Vecinos solidarios');
  });
});
