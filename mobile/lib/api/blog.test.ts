// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn(), delete: jest.fn(), patch: jest.fn() },
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
import { getBlogPosts, getBlogPost } from './blog';
import type { BlogListResponse, BlogPost } from './blog';

const mockPost: BlogPost = {
  id: 10,
  title: 'How Timebanking Works',
  slug: 'how-timebanking-works',
  excerpt: 'A brief overview.',
  content: 'Full content here.',
  featured_image: null,
  category: { id: 2, name: 'Guides', color: 'blue' },
  published_at: '2026-01-15T09:00:00Z',
  reading_time: 5,
};

const mockBlogListResponse: BlogListResponse = {
  data: [mockPost],
  meta: { has_more: false, cursor: null },
};

describe('getBlogPosts', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('calls the correct endpoint with no params on first page', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockBlogListResponse);
    const result = await getBlogPosts(null);
    expect(api.get).toHaveBeenCalledWith('/api/v2/blog', {});
    expect(result.data).toHaveLength(1);
    expect(result.meta.has_more).toBe(false);
  });

  it('includes cursor when provided', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockBlogListResponse);
    await getBlogPosts('cursor-blog-1');
    expect(api.get).toHaveBeenCalledWith('/api/v2/blog', { cursor: 'cursor-blog-1' });
  });

  it('omits cursor when null', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockBlogListResponse);
    await getBlogPosts(null);
    const call = (api.get as jest.Mock).mock.calls[0][1] as Record<string, string>;
    expect(call).not.toHaveProperty('cursor');
  });

  it('includes search param when provided', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockBlogListResponse);
    await getBlogPosts(null, 'timebanking');
    expect(api.get).toHaveBeenCalledWith('/api/v2/blog', { search: 'timebanking' });
  });

  it('omits search when not provided', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockBlogListResponse);
    await getBlogPosts(null);
    const call = (api.get as jest.Mock).mock.calls[0][1] as Record<string, string>;
    expect(call).not.toHaveProperty('search');
  });

  it('includes cursor and search together', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockBlogListResponse);
    await getBlogPosts('cursor-2', 'community');
    expect(api.get).toHaveBeenCalledWith('/api/v2/blog', { cursor: 'cursor-2', search: 'community' });
  });
});

describe('getBlogPost', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('calls the correct endpoint with the post slug', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: mockPost });
    const result = await getBlogPost('how-timebanking-works');
    expect(api.get).toHaveBeenCalledWith('/api/v2/blog/how-timebanking-works');
    expect(result.data.title).toBe('How Timebanking Works');
    expect(result.data.slug).toBe('how-timebanking-works');
  });
});
