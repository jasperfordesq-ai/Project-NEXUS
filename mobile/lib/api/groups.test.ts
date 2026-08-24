// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), patch: jest.fn(), upload: jest.fn() },
  ApiResponseError: class ApiResponseError extends Error {
    status!: number;
    constructor(status: number, message: string) { super(message); this.status = status; this.name = 'ApiResponseError'; }
  },
  registerUnauthorizedCallback: jest.fn(),
}));
jest.mock('@/lib/constants', () => ({
  API_V2: '/api/v2',
  API_BASE_URL: 'https://test.api',
  STORAGE_KEYS: { AUTH_TOKEN: 'auth_token', REFRESH_TOKEN: 'refresh_token', TENANT_SLUG: 'tenant_slug', USER_DATA: 'user_data' },
  TIMEOUTS: { API_REQUEST: 15_000 },
  DEFAULT_TENANT: 'test-tenant',
}));

import { api } from '@/lib/api/client';
import {
  createGroupAnnouncement,
  acceptGroupAnswer,
  answerGroupQuestion,
  createGroupTask,
  createGroupWikiPage,
  deleteGroupFile,
  deleteGroupMedia,
  deleteGroupTask,
  deleteGroupAnnouncement,
  deleteGroupWikiPage,
  createGroupQuestion,
  getGroups,
  getGroup,
  getGroupAnalytics,
  getGroupAnalyticsComparative,
  getGroupAnalyticsRetention,
  getGroupAnnouncements,
  getGroupFiles,
  getGroupQuestion,
  getGroupQuestions,
  getGroupMedia,
  getGroupTasks,
  getGroupTaskStats,
  getGroupTemplates,
  getGroupWikiPage,
  getGroupWikiPages,
  getGroupWikiRevisions,
  joinGroup,
  leaveGroup,
  updateGroup,
  updateGroupAnnouncement,
  updateGroupTask,
  updateGroupWikiPage,
  uploadGroupMedia,
  voteGroupQA,
} from './groups';
import type { GroupsResponse, GroupDetail } from './groups';

const mockGroupsResponse: GroupsResponse = {
  data: [
    {
      id: 1,
      name: 'Test Group',
      description: 'A test group',
      visibility: 'public',
      cover_image: null,
      is_featured: false,
      member_count: 5,
      posts_count: 10,
      is_member: false,
      created_at: '2026-01-01T00:00:00Z',
      recent_members: [],
    },
  ],
  meta: { has_more: false, cursor: null },
};

const mockGroupDetail: GroupDetail = {
  id: 1,
  name: 'Test Group',
  description: 'A test group',
  visibility: 'public',
  cover_image: null,
  is_featured: false,
  member_count: 5,
  posts_count: 10,
  is_member: false,
  created_at: '2026-01-01T00:00:00Z',
  recent_members: [],
  /*
    🔴 `admin` is NOT in `GET /v2/groups/{id}` — measured 2026-08-24. The server sends
    `creator` and `owner_id`. Kept here only to prove the optional field still passes
    through when something does supply it; the creator below is what a real response has.
  */
  admin: { id: 99, name: 'Admin User', avatar_url: null },
  creator: { id: 674, name: 'E2E UserA', avatar_url: null },
  tags: ['community'],
};

describe('getGroups', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('calls the correct endpoint with per_page and no cursor on first page', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockGroupsResponse);
    const result = await getGroups(null);
    expect(api.get).toHaveBeenCalledWith('/api/v2/groups', { per_page: '20' });
    expect(result.data).toHaveLength(1);
    expect(result.meta.has_more).toBe(false);
  });

  it('includes cursor when provided', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockGroupsResponse);
    await getGroups('cursor-abc');
    expect(api.get).toHaveBeenCalledWith('/api/v2/groups', { per_page: '20', cursor: 'cursor-abc' });
  });

  it('includes search param when provided', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockGroupsResponse);
    await getGroups(null, { search: 'gardening' });
    expect(api.get).toHaveBeenCalledWith('/api/v2/groups', { per_page: '20', q: 'gardening' });
  });

  it('includes visibility param when provided', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockGroupsResponse);
    await getGroups(null, { visibility: 'public' });
    expect(api.get).toHaveBeenCalledWith('/api/v2/groups', { per_page: '20', visibility: 'public' });
  });

  it('includes all optional params together with cursor', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockGroupsResponse);
    await getGroups('next-cursor', { search: 'sport', visibility: 'private' });
    expect(api.get).toHaveBeenCalledWith('/api/v2/groups', {
      per_page: '20',
      cursor: 'next-cursor',
      q: 'sport',
      visibility: 'private',
    });
  });

  it('omits search and visibility when not provided', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockGroupsResponse);
    await getGroups(null, {});
    const call = (api.get as jest.Mock).mock.calls[0][1] as Record<string, string>;
    expect(call).not.toHaveProperty('search');
    expect(call).not.toHaveProperty('visibility');
  });
});

describe('getGroup', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('calls the correct endpoint with the group ID', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: mockGroupDetail });
    const result = await getGroup(42);
    expect(api.get).toHaveBeenCalledWith('/api/v2/groups/42');
    expect(result.data.id).toBe(1);
    expect(result.data.admin?.name).toBe('Admin User');
    // What a real response actually carries, and what the screen now falls back to.
    expect(result.data.creator?.name).toBe('E2E UserA');
  });
});

describe('getGroupTemplates', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('calls the group templates endpoint', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [{ id: 1, name: 'Club', default_visibility: 'private' }] });

    const result = await getGroupTemplates();

    expect(api.get).toHaveBeenCalledWith('/api/v2/group-templates');
    expect(Array.isArray('data' in result ? result.data : result)).toBe(true);
  });
});

describe('updateGroup', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('sends PUT to the group endpoint with editable group fields', async () => {
    (api.put as jest.Mock).mockResolvedValue({ data: { ...mockGroupDetail, name: 'Updated Group' } });

    const result = await updateGroup(42, {
      name: 'Updated Group',
      description: 'An updated group description that meets the mobile parity rules.',
      visibility: 'private',
      location: 'Community hall',
      federated_visibility: 'listed',
    });

    expect(api.put).toHaveBeenCalledWith('/api/v2/groups/42', {
      name: 'Updated Group',
      description: 'An updated group description that meets the mobile parity rules.',
      visibility: 'private',
      location: 'Community hall',
      federated_visibility: 'listed',
    });
    expect(result.data.name).toBe('Updated Group');
  });
});

describe('group announcement helpers', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('loads group announcements with the mobile page limit', async () => {
    const response = { data: { items: [], cursor: null, has_more: false } };
    (api.get as jest.Mock).mockResolvedValue(response);

    const result = await getGroupAnnouncements(7);

    expect(api.get).toHaveBeenCalledWith('/api/v2/groups/7/announcements', { limit: '20' });
    expect(result.data.items).toEqual([]);
  });

  it('creates a group announcement', async () => {
    const payload = { title: 'Spring update', content: 'Seeds arrive Friday.', is_pinned: true };
    (api.post as jest.Mock).mockResolvedValue({ data: { id: 9, ...payload } });

    await createGroupAnnouncement(7, payload);

    expect(api.post).toHaveBeenCalledWith('/api/v2/groups/7/announcements', payload);
  });

  it('updates a group announcement', async () => {
    (api.put as jest.Mock).mockResolvedValue({ data: { id: 9, is_pinned: false } });

    await updateGroupAnnouncement(7, 9, { is_pinned: false });

    expect(api.put).toHaveBeenCalledWith('/api/v2/groups/7/announcements/9', { is_pinned: false });
  });

  it('deletes a group announcement', async () => {
    (api.delete as jest.Mock).mockResolvedValue({ data: { deleted: true } });

    await deleteGroupAnnouncement(7, 9);

    expect(api.delete).toHaveBeenCalledWith('/api/v2/groups/7/announcements/9');
  });
});

describe('group file helpers', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('loads group files with the mobile page size', async () => {
    const response = { data: { items: [], cursor: null, has_more: false } };
    (api.get as jest.Mock).mockResolvedValue(response);

    const result = await getGroupFiles(7);

    expect(api.get).toHaveBeenCalledWith('/api/v2/groups/7/files', { per_page: '20' });
    expect(result.data.items).toEqual([]);
  });

  it('deletes a group file', async () => {
    (api.delete as jest.Mock).mockResolvedValue({ data: { message: 'Deleted' } });

    await deleteGroupFile(7, 31);

    expect(api.delete).toHaveBeenCalledWith('/api/v2/groups/7/files/31');
  });
});

describe('group media helpers', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('loads group media with default page size', async () => {
    const response = { data: { items: [], cursor: null, has_more: false } };
    (api.get as jest.Mock).mockResolvedValue(response);

    const result = await getGroupMedia(7);

    expect(api.get).toHaveBeenCalledWith('/api/v2/groups/7/media', { per_page: '20' });
    expect(result.data.items).toEqual([]);
  });

  it('loads group media with a type filter', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: { items: [], cursor: null, has_more: false } });

    await getGroupMedia(7, { type: 'video' });

    expect(api.get).toHaveBeenCalledWith('/api/v2/groups/7/media', { per_page: '20', type: 'video' });
  });

  it('deletes a group media item', async () => {
    (api.delete as jest.Mock).mockResolvedValue({ data: { message: 'Deleted' } });

    await deleteGroupMedia(7, 81);

    expect(api.delete).toHaveBeenCalledWith('/api/v2/groups/7/media/81');
  });

  it('uploads group media as multipart form data', async () => {
    (api.upload as jest.Mock).mockResolvedValue({
      data: { id: 82, url: '/uploads/groups/media.jpg', type: 'image', uploaded_by: 10, created_at: '2026-06-01T00:00:00Z' },
    });

    const result = await uploadGroupMedia(7, {
      uri: 'file:///tmp/group-media.jpg',
      fileName: 'group-media.jpg',
      mimeType: 'image/jpeg',
    });

    expect(api.upload).toHaveBeenCalledWith('/api/v2/groups/7/media', expect.any(FormData));
    expect(result.data.id).toBe(82);
  });
});

describe('group analytics helpers', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('loads the group analytics dashboard with a day window', async () => {
    const response = {
      data: {
        overview: { total_members: 12 },
        member_growth: [],
        engagement: { timeline: [], summary: { active_members: 6 } },
        top_contributors: [],
        content_performance: [],
        activity_breakdown: { total: 0 },
      },
    };
    (api.get as jest.Mock).mockResolvedValue(response);

    const result = await getGroupAnalytics(7, 90);

    expect(api.get).toHaveBeenCalledWith('/api/v2/groups/7/analytics', { days: '90' });
    expect(result.data.overview.total_members).toBe(12);
  });

  it('loads group retention analytics with a month window', async () => {
    const response = { data: [{ month: '2026-06', joined: 4, still_active: 3, retention_rate: 75 }] };
    (api.get as jest.Mock).mockResolvedValue(response);

    const result = await getGroupAnalyticsRetention(7, 12);

    expect(api.get).toHaveBeenCalledWith('/api/v2/groups/7/analytics/retention', { months: '12' });
    expect(result.data[0].retention_rate).toBe(75);
  });

  it('loads group comparative analytics', async () => {
    const response = { data: { group_members: 12, avg_members: 8, percentile: 80, total_groups: 5, rank: 2 } };
    (api.get as jest.Mock).mockResolvedValue(response);

    const result = await getGroupAnalyticsComparative(7);

    expect(api.get).toHaveBeenCalledWith('/api/v2/groups/7/analytics/comparative');
    expect(result.data.rank).toBe(2);
  });
});

describe('group Q&A helpers', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('loads group questions with default sort', async () => {
    const response = { data: { items: [], cursor: null, has_more: false } };
    (api.get as jest.Mock).mockResolvedValue(response);

    const result = await getGroupQuestions(7);

    expect(api.get).toHaveBeenCalledWith('/api/v2/groups/7/questions', { per_page: '20', sort: 'newest' });
    expect(result.data.items).toEqual([]);
  });

  it('loads one group question with answers', async () => {
    const response = { data: { id: 4, title: 'How do we compost?', answers: [] } };
    (api.get as jest.Mock).mockResolvedValue(response);

    const result = await getGroupQuestion(7, 4);

    expect(api.get).toHaveBeenCalledWith('/api/v2/groups/7/questions/4');
    expect(result.data.answers).toEqual([]);
  });

  it('creates a group question', async () => {
    const payload = { title: 'How do we compost safely?', body: 'What is the best bin setup?' };
    (api.post as jest.Mock).mockResolvedValue({ data: { id: 4, title: payload.title } });

    await createGroupQuestion(7, payload);

    expect(api.post).toHaveBeenCalledWith('/api/v2/groups/7/questions', payload);
  });

  it('votes on a group question or answer', async () => {
    const payload = { type: 'question' as const, target_id: 4, vote: 'up' as const };
    (api.post as jest.Mock).mockResolvedValue({ data: { message: 'Vote recorded' } });

    await voteGroupQA(7, payload);

    expect(api.post).toHaveBeenCalledWith('/api/v2/groups/7/qa/vote', payload);
  });

  it('accepts a group answer', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { message: 'Accepted' } });

    await acceptGroupAnswer(7, 50);

    expect(api.post).toHaveBeenCalledWith('/api/v2/groups/7/answers/50/accept', {});
  });

  it('answers a group question', async () => {
    const payload = { body: 'Use a lidded outdoor bin.' };
    (api.post as jest.Mock).mockResolvedValue({ data: { id: 5, question_id: 4 } });

    await answerGroupQuestion(7, 4, payload);

    expect(api.post).toHaveBeenCalledWith('/api/v2/groups/7/questions/4/answers', payload);
  });
});

describe('group wiki helpers', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('loads group wiki pages', async () => {
    const response = { data: [{ id: 12, title: 'Compost guide', slug: 'compost-guide' }] };
    (api.get as jest.Mock).mockResolvedValue(response);

    const result = await getGroupWikiPages(7);

    expect(api.get).toHaveBeenCalledWith('/api/v2/groups/7/wiki');
    expect(result.data[0].slug).toBe('compost-guide');
  });

  it('loads one group wiki page by slug', async () => {
    const response = { data: { id: 12, title: 'Compost guide', slug: 'compost-guide', content: 'Use a lidded bin.' } };
    (api.get as jest.Mock).mockResolvedValue(response);

    const result = await getGroupWikiPage(7, 'compost-guide');

    expect(api.get).toHaveBeenCalledWith('/api/v2/groups/7/wiki/compost-guide');
    expect(result.data.content).toBe('Use a lidded bin.');
  });

  it('creates a group wiki page', async () => {
    const payload = { title: 'Tool care', content: 'Clean tools after use.' };
    (api.post as jest.Mock).mockResolvedValue({ data: { id: 13, ...payload } });

    await createGroupWikiPage(7, payload);

    expect(api.post).toHaveBeenCalledWith('/api/v2/groups/7/wiki', payload);
  });

  it('updates a group wiki page', async () => {
    const payload = { title: 'Tool care', content: 'Keep tools dry.', change_summary: 'Clarified storage.' };
    (api.put as jest.Mock).mockResolvedValue({ data: { id: 13, ...payload } });

    await updateGroupWikiPage(7, 13, payload);

    expect(api.put).toHaveBeenCalledWith('/api/v2/groups/7/wiki/13', payload);
  });

  it('loads group wiki revisions', async () => {
    const response = { data: [{ id: 99, content: 'Old copy', change_summary: 'Initial', editor: { id: 10, name: 'Alice' } }] };
    (api.get as jest.Mock).mockResolvedValue(response);

    const result = await getGroupWikiRevisions(7, 13);

    expect(api.get).toHaveBeenCalledWith('/api/v2/groups/7/wiki/13/revisions');
    expect(result.data[0].content).toBe('Old copy');
  });

  it('deletes a group wiki page', async () => {
    (api.delete as jest.Mock).mockResolvedValue({ data: { message: 'Deleted' } });

    await deleteGroupWikiPage(7, 13);

    expect(api.delete).toHaveBeenCalledWith('/api/v2/groups/7/wiki/13');
  });
});

describe('group task helpers', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('loads group tasks with default page size', async () => {
    const response = { data: [], meta: { cursor: null, has_more: false } };
    (api.get as jest.Mock).mockResolvedValue(response);

    const result = await getGroupTasks(7);

    expect(api.get).toHaveBeenCalledWith('/api/v2/groups/7/tasks', { per_page: '50' });
    expect(result.data).toEqual([]);
  });

  it('loads group tasks with a status filter', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [], meta: { cursor: null, has_more: false } });

    await getGroupTasks(7, { status: 'in_progress' });

    expect(api.get).toHaveBeenCalledWith('/api/v2/groups/7/tasks', { per_page: '50', status: 'in_progress' });
  });

  it('loads group task stats', async () => {
    const response = { data: { total: 2, todo: 1, in_progress: 1, done: 0, overdue: 0 } };
    (api.get as jest.Mock).mockResolvedValue(response);

    const result = await getGroupTaskStats(7);

    expect(api.get).toHaveBeenCalledWith('/api/v2/groups/7/task-stats');
    expect(result.data.total).toBe(2);
  });

  it('creates a group task', async () => {
    const payload = { title: 'Water seedlings', description: 'Use the small greenhouse cans.', priority: 'high' as const };
    (api.post as jest.Mock).mockResolvedValue({ data: { id: 70, ...payload } });

    await createGroupTask(7, payload);

    expect(api.post).toHaveBeenCalledWith('/api/v2/groups/7/tasks', payload);
  });

  it('updates a group task', async () => {
    (api.put as jest.Mock).mockResolvedValue({ data: { id: 70, status: 'done' } });

    await updateGroupTask(70, { status: 'done' });

    expect(api.put).toHaveBeenCalledWith('/api/v2/team-tasks/70', { status: 'done' });
  });

  it('deletes a group task', async () => {
    (api.delete as jest.Mock).mockResolvedValue(undefined);

    await deleteGroupTask(70);

    expect(api.delete).toHaveBeenCalledWith('/api/v2/team-tasks/70');
  });
});

describe('joinGroup', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('sends POST to the correct join endpoint with empty body', async () => {
    (api.post as jest.Mock).mockResolvedValue({ message: 'Joined successfully' });
    const result = await joinGroup(7);
    expect(api.post).toHaveBeenCalledWith('/api/v2/groups/7/join', {});
    expect(result.message).toBe('Joined successfully');
  });
});

describe('leaveGroup', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('sends DELETE to the correct leave endpoint', async () => {
    (api.delete as jest.Mock).mockResolvedValue(undefined);
    await leaveGroup(7);
    expect(api.delete).toHaveBeenCalledWith('/api/v2/groups/7/membership');
  });
});
