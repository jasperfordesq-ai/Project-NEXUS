// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
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
  getUserEndorsements,
  getMySkills,
  endorseSkill,
  removeSkillEndorsement,
  addSkill,
  removeSkill,
  getAvailableSkills,
  getMembersWithSkill,
  getSkillCategory,
  getSkillCategories,
} from './endorsements';
import type { EndorsementsResponse, Skill, Endorsement } from './endorsements';

const mockSkill: Skill = { id: 10, name: 'Gardening', category: 'Outdoors' };

const mockEndorsement: Endorsement = {
  id: 1,
  skill: mockSkill,
  endorsed_by: { id: 99, name: 'Alice', avatar: null },
  message: 'Great work!',
  created_at: '2026-01-01T00:00:00Z',
};

const mockEndorsementsResponse: EndorsementsResponse = {
  data: [mockEndorsement],
  meta: { total: 1, has_more: false, cursor: null },
};

const mockRawSkillsResponse = {
  data: [
    {
      id: 10,
      skill_name: 'Gardening',
      category_name: 'Outdoors',
      endorsement_count: '2',
    },
  ],
};

describe('getUserEndorsements', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('calls the correct endpoint with no cursor on first page', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockEndorsementsResponse);
    const result = await getUserEndorsements(42);
    expect(api.get).toHaveBeenCalledWith('/api/v2/members/42/endorsements', {});
    expect(result.data).toHaveLength(1);
    expect(result.meta.has_more).toBe(false);
  });

  it('includes cursor param when provided', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockEndorsementsResponse);
    await getUserEndorsements(42, 'cursor-xyz');
    expect(api.get).toHaveBeenCalledWith('/api/v2/members/42/endorsements', { cursor: 'cursor-xyz' });
  });

  it('omits cursor when null is passed', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockEndorsementsResponse);
    await getUserEndorsements(7, null);
    const params = (api.get as jest.Mock).mock.calls[0][1] as Record<string, string>;
    expect(params).not.toHaveProperty('cursor');
  });

  it('rejects with the underlying error on API failure', async () => {
    (api.get as jest.Mock).mockRejectedValue(new Error('Network error'));
    await expect(getUserEndorsements(1)).rejects.toThrow('Network error');
  });
});

describe('getMySkills', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('calls /api/v2/users/me/skills and returns skills + endorsements', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockRawSkillsResponse);
    const result = await getMySkills();
    expect(api.get).toHaveBeenCalledWith('/api/v2/users/me/skills');
    expect(result.data.skills).toHaveLength(1);
    expect(result.data.skills[0]).toEqual({
      id: 10,
      name: 'Gardening',
      category: 'Outdoors',
      endorsement_count: 2,
    });
    expect(result.data.endorsements).toHaveLength(0);
  });
});

describe('endorseSkill', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  /*
    🔴 These two used to pin the WRONG payload.

    The function sent `skill_id` alone, and `EndorsementService::endorse` requires
    `skill_name` and refuses without it — `skill_id` is optional and only stored. So the
    test proved the app sent something the server would reject. It never showed up
    because the function had no callers anywhere in the app: a member could not endorse
    anyone at all, and endorsements could only ever arrive from the website. Found by the
    2026-09-07 audit (F/F-3).
  */
  it('🔴 sends the skill NAME, which is the field the server requires', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { endorsement_id: 1, message: 'Endorsement added' } });

    const result = await endorseSkill(5, 'Gardening', 'Great help!');

    expect(api.post).toHaveBeenCalledWith('/api/v2/members/5/endorse', {
      skill_name: 'Gardening',
      comment: 'Great help!',
    });
    expect(result.data.endorsement_id).toBe(1);
  });

  it('omits the comment entirely when none was written', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { endorsement_id: 2, message: 'Endorsement added' } });

    await endorseSkill(5, 'Gardening');

    const body = (api.post as jest.Mock).mock.calls[0][1] as Record<string, unknown>;
    expect(body.skill_name).toBe('Gardening');
    expect('comment' in body).toBe(false);
  });
});

describe('removeSkillEndorsement', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('sends the skill name as a query parameter, because DELETE carries no body', async () => {
    (api.delete as jest.Mock).mockResolvedValue({ data: { message: 'Removed' } });

    await removeSkillEndorsement(5, 'Gardening');

    expect(api.delete).toHaveBeenCalledWith('/api/v2/members/5/endorse', {
      params: { skill_name: 'Gardening' },
    });
  });
});

describe('addSkill', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('sends POST with skill name to /api/v2/users/me/skills', async () => {
    (api.post as jest.Mock).mockResolvedValue(mockRawSkillsResponse);
    const result = await addSkill('Cooking');
    expect(api.post).toHaveBeenCalledWith('/api/v2/users/me/skills', { skill_name: 'Cooking' });
    expect(result.data.name).toBe('Cooking');
  });
});

describe('removeSkill', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('sends DELETE to the correct skill endpoint', async () => {
    (api.delete as jest.Mock).mockResolvedValue(undefined);
    await removeSkill(10);
    expect(api.delete).toHaveBeenCalledWith('/api/v2/users/me/skills/10');
  });

  it('propagates errors from the API', async () => {
    (api.delete as jest.Mock).mockRejectedValue(new Error('Forbidden'));
    await expect(removeSkill(10)).rejects.toThrow('Forbidden');
  });
});

describe('getAvailableSkills', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('calls /api/v2/skills/search and returns skill list', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockRawSkillsResponse);
    const result = await getAvailableSkills('garden');
    expect(api.get).toHaveBeenCalledWith('/api/v2/skills/search', { q: 'garden' });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Gardening');
  });

  it('does not call the API for an empty search', async () => {
    const result = await getAvailableSkills();
    expect(api.get).not.toHaveBeenCalled();
    expect(result.data).toEqual([]);
  });
});

describe('getSkillCategories', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('loads the public skill category tree', async () => {
    const response = {
      data: [{ id: 1, name: 'Home & Garden', skills_count: 5, children: [] }],
    };
    (api.get as jest.Mock).mockResolvedValue(response);

    const result = await getSkillCategories();

    expect(api.get).toHaveBeenCalledWith('/api/v2/skills/categories');
    expect(result.data[0].name).toBe('Home & Garden');
  });
});

describe('getSkillCategory', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('loads category detail with skill breakdown', async () => {
    const response = {
      data: {
        id: 1,
        name: 'Home & Garden',
        skills: [{ skill_name: 'Gardening', user_count: 4, offering_count: 3, requesting_count: 1 }],
      },
    };
    (api.get as jest.Mock).mockResolvedValue(response);

    const result = await getSkillCategory(1);

    expect(api.get).toHaveBeenCalledWith('/api/v2/skills/categories/1');
    expect(result.data.skills[0].skill_name).toBe('Gardening');
  });
});

describe('getMembersWithSkill', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('loads members who have a selected skill', async () => {
    const response = {
      data: [{ id: 2, first_name: 'Alice', last_name: 'Member', proficiency_level: 'advanced' }],
    };
    (api.get as jest.Mock).mockResolvedValue(response);

    const result = await getMembersWithSkill('Gardening', 12);

    expect(api.get).toHaveBeenCalledWith('/api/v2/skills/members', { skill: 'Gardening', limit: '12' });
    expect(result.data[0].first_name).toBe('Alice');
  });
});
