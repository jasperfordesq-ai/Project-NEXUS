// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import {
  acceptGroupInvite,
  createGroupInviteLink,
  decideGroupJoinRequest,
  deleteGroup,
  getGroupDetail,
  getGroupInvitePreview,
  joinGroup,
  leaveGroup,
  listGroupEvents,
  listGroupInvites,
  listGroupJoinRequests,
  listGroupMembers,
  removeGroupMember,
  revokeGroupInvite,
  sendGroupInvites,
  updateGroupMemberRole,
  updateGroupSettings,
  uploadGroupImage,
} from './groupDetail';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
}));

const group = {
  id: 8,
  name: 'Garden Crew',
  description: 'Grow together',
  visibility: 'private' as const,
  members_count: 2,
  is_member: true,
  created_at: '2026-07-01T00:00:00Z',
};

const member = (id: number, name = `Member ${id}`) => ({
  id,
  name,
  role: 'member' as const,
  joined_at: '2026-07-01T00:00:00Z',
  capabilities: { can_change_role: false, can_remove: false },
});

const event = (id: number, title: string, startDate: string) => ({
  id,
  title,
  start_date: startDate,
});

describe('group-detail adapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads a typed detail with cancellation and rejects false or malformed envelopes', async () => {
    const controller = new AbortController();
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: group })
      .mockResolvedValueOnce({ success: false, code: 'HTTP_404' })
      .mockResolvedValueOnce({ success: true, data: {} as never });

    await expect(getGroupDetail(8, { signal: controller.signal })).resolves.toEqual(group);
    expect(api.get).toHaveBeenCalledWith('/v2/groups/8', { signal: controller.signal });
    await expect(getGroupDetail(8)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getGroupDetail(8)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('lists join requests through the exact read route', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });

    await expect(listGroupJoinRequests(8)).resolves.toEqual([]);

    expect(api.get).toHaveBeenCalledWith('/v2/groups/8/requests', { signal: undefined });
  });

  it('loads member 21 through signed cursor paging and binds normalized server search to the cursor route', async () => {
    const firstTwenty = Array.from({ length: 20 }, (_, index) => member(index + 1));
    vi.mocked(api.get)
      .mockResolvedValueOnce({
        success: true,
        data: firstTwenty,
        meta: { per_page: 20, has_more: true, cursor: 'members-page-2' },
      })
      .mockResolvedValueOnce({
        success: true,
        data: [member(21)],
        meta: { per_page: 20, has_more: false },
      })
      .mockResolvedValueOnce({
        success: true,
        data: [member(3, 'Alice Green')],
        meta: { per_page: 20, has_more: false },
      });

    await expect(listGroupMembers(8)).resolves.toEqual({
      items: firstTwenty,
      nextCursor: 'members-page-2',
      hasMore: true,
      perPage: 20,
    });
    await expect(listGroupMembers(8, { cursor: 'members-page-2' })).resolves.toEqual({
      items: [member(21)],
      nextCursor: null,
      hasMore: false,
      perPage: 20,
    });
    await expect(listGroupMembers(8, {
      search: '  Alice   Green  ',
      cursor: 'signed-search-page',
    })).resolves.toEqual({
      items: [member(3, 'Alice Green')],
      nextCursor: null,
      hasMore: false,
      perPage: 20,
    });

    expect(api.get).toHaveBeenNthCalledWith(1, '/v2/groups/8/members?per_page=20', { signal: undefined });
    expect(api.get).toHaveBeenNthCalledWith(2, '/v2/groups/8/members?per_page=20&cursor=members-page-2', { signal: undefined });
    expect(api.get).toHaveBeenNthCalledWith(
      3,
      '/v2/groups/8/members?per_page=20&q=Alice+Green&cursor=signed-search-page',
      { signal: undefined },
    );
  });

  it('requests every group event with when=all and reaches ongoing and past records across cursor pages', async () => {
    const ongoing = event(31, 'Ongoing workshop', '2026-07-11T09:00:00Z');
    const past = event(30, 'Past workshop', '2026-07-01T09:00:00Z');
    vi.mocked(api.get)
      .mockResolvedValueOnce({
        success: true,
        data: [ongoing],
        meta: { per_page: 20, has_more: true, cursor: 'events-page-2' },
      })
      .mockResolvedValueOnce({
        success: true,
        data: [past],
        meta: { per_page: 20, has_more: false },
      });

    await expect(listGroupEvents(8)).resolves.toMatchObject({
      items: [ongoing],
      nextCursor: 'events-page-2',
      hasMore: true,
    });
    await expect(listGroupEvents(8, { cursor: 'events-page-2' })).resolves.toMatchObject({
      items: [past],
      nextCursor: null,
      hasMore: false,
    });

    expect(api.get).toHaveBeenNthCalledWith(1, '/v2/events?group_id=8&when=all&per_page=20', { signal: undefined });
    expect(api.get).toHaveBeenNthCalledWith(
      2,
      '/v2/events?group_id=8&when=all&per_page=20&cursor=events-page-2',
      { signal: undefined },
    );
  });

  it.each([
    ['missing metadata', { success: true, data: [member(1)] }, {}],
    ['wrong page size', { success: true, data: [member(1)], meta: { per_page: 19, has_more: false } }, {}],
    ['missing next cursor', { success: true, data: [member(1)], meta: { per_page: 20, has_more: true } }, {}],
    ['cursor on a final page', { success: true, data: [member(1)], meta: { per_page: 20, has_more: false, cursor: 'unexpected' } }, {}],
    ['repeated next cursor', { success: true, data: [member(1)], meta: { per_page: 20, has_more: true, cursor: 'same' } }, { cursor: 'same' }],
    ['malformed member', { success: true, data: [{ id: 1, name: '' }], meta: { per_page: 20, has_more: false } }, {}],
  ])('rejects %s in a resolved member collection', async (_label, response, options) => {
    vi.mocked(api.get).mockResolvedValueOnce(response as never);
    await expect(listGroupMembers(8, options)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects malformed event DTOs and resolved collection failures', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({
        success: true,
        data: [{ id: 1, title: '', start_date: '2026-07-11' }],
        meta: { per_page: 20, has_more: false },
      })
      .mockResolvedValueOnce({ success: false, code: 'HTTP_403' });

    await expect(listGroupEvents(8)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(listGroupEvents(8)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('normalizes invite and membership contracts', async () => {
    const invite = {
      id: 4,
      type: 'link' as const,
      status: 'pending' as const,
      invite_url: 'https://example.test/invite',
      expires_at: '2026-07-20T00:00:00Z',
    };
    vi.mocked(api.post)
      .mockResolvedValueOnce({ success: true, data: invite })
      .mockResolvedValueOnce({ success: true, data: [{ email: 'member@example.test', status: 'sent' }] })
      .mockResolvedValueOnce({ success: true, data: { status: 'pending', action: 'requested' } })
      .mockResolvedValueOnce({ success: true, data: { status: 'unexpected' } });

    await expect(createGroupInviteLink(8)).resolves.toEqual(invite);
    await expect(sendGroupInvites(8, { emails: ['member@example.test'], message: 'Welcome' })).resolves.toEqual([
      { email: 'member@example.test', status: 'sent' },
    ]);
    await expect(joinGroup(8)).resolves.toEqual({ status: 'pending', action: 'requested' });
    await expect(joinGroup(8)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('lists, previews, accepts, and revokes invitations through exact routes', async () => {
    const invite = {
      id: 4,
      type: 'email' as const,
      status: 'pending' as const,
      expires_at: '2026-07-20T00:00:00Z',
    };
    const preview = {
      invite: { ...invite, email_bound: true },
      group: { id: 8, name: 'Garden Crew', visibility: 'private' as const, member_count: 2 },
      membership: { status: 'none' as const },
    };
    const acceptance = {
      action: 'joined' as const,
      group: { id: 8, name: 'Garden Crew' },
      membership: { status: 'active' as const, role: 'member' as const },
      invite: { id: 4, type: 'email' as const, status: 'accepted' as const },
    };
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: [invite] })
      .mockResolvedValueOnce({ success: true, data: preview });
    vi.mocked(api.post).mockResolvedValueOnce({ success: true, data: acceptance });
    vi.mocked(api.delete).mockResolvedValueOnce({ success: true, data: { id: 4, status: 'revoked' } });

    await expect(listGroupInvites(8)).resolves.toEqual([invite]);
    await expect(getGroupInvitePreview('a'.repeat(40))).resolves.toEqual(preview);
    await expect(acceptGroupInvite('a'.repeat(40))).resolves.toEqual(acceptance);
    await expect(revokeGroupInvite(8, 4)).resolves.toBeUndefined();

    expect(api.get).toHaveBeenNthCalledWith(1, '/v2/groups/8/invites', { signal: undefined });
    expect(api.get).toHaveBeenNthCalledWith(2, `/v2/groups/invite/${'a'.repeat(40)}`, { signal: undefined });
    expect(api.post).toHaveBeenCalledWith(`/v2/groups/invite/${'a'.repeat(40)}/accept`);
    expect(api.delete).toHaveBeenCalledWith('/v2/groups/8/invites/4');
  });

  it('normalizes upload response aliases and rejects missing URLs', async () => {
    vi.mocked(api.upload)
      .mockResolvedValueOnce({ success: true, data: { image_url: '/uploads/group.png' } })
      .mockResolvedValueOnce({ success: true, data: {} });
    const file = new File(['image'], 'group.png', { type: 'image/png' });

    await expect(uploadGroupImage(8, file, 'avatar')).resolves.toBe('/uploads/group.png');
    expect(api.upload).toHaveBeenCalledWith('/v2/groups/8/image', expect.any(FormData));
    await expect(uploadGroupImage(8, file, 'cover')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('routes confirmed mutations through exact parent and child endpoints', async () => {
    vi.mocked(api.put).mockResolvedValue({ success: true });
    vi.mocked(api.post).mockResolvedValue({ success: true });
    vi.mocked(api.delete)
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true, data: { status: 'none', action: 'left' } })
      .mockResolvedValueOnce({ success: true });

    await updateGroupSettings(8, {
      name: 'Garden Crew',
      description: 'Grow together',
      visibility: 'private',
      location: 'Town',
    });
    await decideGroupJoinRequest(8, 12, 'accept');
    await updateGroupMemberRole(8, 12, 'admin');
    await removeGroupMember(8, 12);
    await leaveGroup(8);
    await deleteGroup(8);

    expect(api.post).toHaveBeenCalledWith('/v2/groups/8/requests/12', { action: 'accept' });
    expect(api.put).toHaveBeenCalledWith('/v2/groups/8/members/12', { role: 'admin' });
    expect(api.delete).toHaveBeenCalledWith('/v2/groups/8/members/12');
    expect(api.delete).toHaveBeenCalledWith('/v2/groups/8/membership');
    expect(api.delete).toHaveBeenCalledWith('/v2/groups/8');
  });

  it('turns resolved mutation failures into domain errors', async () => {
    vi.mocked(api.delete).mockResolvedValue({ success: false, code: 'HTTP_403' });

    await expect(deleteGroup(8)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
