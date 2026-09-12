// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), patch: jest.fn() },
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
  createGoal,
  createGoalFromTemplate,
  completeGoal,
  getGoalTemplateCategories,
  getGoalTemplates,
  getGoals,
  updateGoalStatus,
} from './goals';
import type { GoalsResponse, Goal } from './goals';

const mockGoal: Goal = {
  id: 1,
  title: 'Give 10 hours this month',
  description: 'Focus on tutoring services',
  status: 'active',
  target_hours: 10,
  progress_hours: 3,
  due_date: '2026-02-28T00:00:00Z',
  created_at: '2026-02-01T00:00:00Z',
};

const mockGoalsResponse: GoalsResponse = {
  data: [mockGoal],
  meta: { has_more: false, cursor: null },
};

describe('getGoals', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('calls the correct endpoint with no cursor on first page', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockGoalsResponse);
    const result = await getGoals(null);
    expect(api.get).toHaveBeenCalledWith('/api/v2/goals', {});
    expect(result.data).toHaveLength(1);
    expect(result.meta.has_more).toBe(false);
  });

  it('includes cursor when provided', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockGoalsResponse);
    await getGoals('cursor-goals-1');
    expect(api.get).toHaveBeenCalledWith('/api/v2/goals', { cursor: 'cursor-goals-1' });
  });

  it('omits cursor when null', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockGoalsResponse);
    await getGoals(null);
    const call = (api.get as jest.Mock).mock.calls[0][1] as Record<string, string>;
    expect(call).not.toHaveProperty('cursor');
  });

  it('returns the resolved response data unchanged', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockGoalsResponse);
    const result = await getGoals(null);
    expect(result.data[0].title).toBe('Give 10 hours this month');
    expect(result.data[0].progress_hours).toBe(3);
  });
});

describe('createGoal', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('sends POST to the correct endpoint with required title', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: mockGoal });
    const result = await createGoal({ title: 'Give 10 hours this month' });
    expect(api.post).toHaveBeenCalledWith('/api/v2/goals', { title: 'Give 10 hours this month' });
    expect(result.data.id).toBe(1);
  });

  it('sends POST with all optional fields when provided', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: mockGoal });
    await createGoal({
      title: 'New Goal',
      description: 'Some description',
      target_hours: 20,
      due_date: '2026-03-31',
    });
    expect(api.post).toHaveBeenCalledWith('/api/v2/goals', {
      title: 'New Goal',
      description: 'Some description',
      target_hours: 20,
      due_date: '2026-03-31',
    });
  });
});

describe('goal templates', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('loads goal templates with the default page size', async () => {
    const response = {
      data: [{ id: 4, title: 'Volunteer starter', default_target_value: 10, category: 'community' }],
      meta: { has_more: false, cursor: null },
    };
    (api.get as jest.Mock).mockResolvedValue(response);

    const result = await getGoalTemplates();

    expect(api.get).toHaveBeenCalledWith('/api/v2/goals/templates', { per_page: '50' });
    expect(result.data[0].title).toBe('Volunteer starter');
  });

  it('loads goal templates filtered by category', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [], meta: { has_more: false, cursor: null } });

    await getGoalTemplates('community');

    expect(api.get).toHaveBeenCalledWith('/api/v2/goals/templates', { per_page: '50', category: 'community' });
  });

  it('loads goal template categories', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: ['community', 'learning'] });

    const result = await getGoalTemplateCategories();

    expect(api.get).toHaveBeenCalledWith('/api/v2/goals/templates/categories');
    expect(result.data).toContain('community');
  });

  it('creates a goal from a template', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: mockGoal });

    const result = await createGoalFromTemplate(4);

    expect(api.post).toHaveBeenCalledWith('/api/v2/goals/from-template/4', {});
    expect(result.data.id).toBe(mockGoal.id);
  });
});

describe('updateGoalStatus', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('sends PUT to the correct endpoint with completed status', async () => {
    const completedGoal: Goal = { ...mockGoal, status: 'completed' };
    (api.put as jest.Mock).mockResolvedValue({ data: completedGoal });
    const result = await updateGoalStatus(1, 'completed');
    expect(api.put).toHaveBeenCalledWith('/api/v2/goals/1', { status: 'completed' });
    expect(result.data.status).toBe('completed');
  });

  it('sends PUT to the correct endpoint with abandoned status', async () => {
    const abandonedGoal: Goal = { ...mockGoal, status: 'abandoned' };
    (api.put as jest.Mock).mockResolvedValue({ data: abandonedGoal });
    await updateGoalStatus(7, 'abandoned');
    expect(api.put).toHaveBeenCalledWith('/api/v2/goals/7', { status: 'abandoned' });
  });
});

describe('completeGoal', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('uses the canonical completion endpoint', async () => {
    const completedGoal: Goal = { ...mockGoal, status: 'completed' };
    (api.post as jest.Mock).mockResolvedValue({ data: completedGoal });

    const result = await completeGoal(1);

    expect(api.post).toHaveBeenCalledWith('/api/v2/goals/1/complete');
    expect(result.data.status).toBe('completed');
  });
});
