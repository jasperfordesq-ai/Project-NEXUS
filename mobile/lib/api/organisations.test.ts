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
import { createOrganisation, getOrganisations, getOrganisation } from './organisations';
import type { OrganisationsResponse, Organisation } from './organisations';

const mockOrganisation: Organisation = {
  id: 5,
  name: 'Community Care Ltd',
  description: 'A care-focused community organisation.',
  logo: null,
  website: 'https://communitycare.example',
  location: 'Cork',
  members_count: 42,
  listings_count: 8,
  verified: true,
  created_at: '2025-06-01T00:00:00Z',
};

const mockOrganisationsResponse: OrganisationsResponse = {
  data: [mockOrganisation],
  meta: { has_more: false, cursor: null },
};

describe('getOrganisations', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('calls the correct endpoint with no params on first page', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockOrganisationsResponse);
    const result = await getOrganisations(null);
    expect(api.get).toHaveBeenCalledWith('/api/v2/volunteering/organisations', {});
    expect(result.data).toHaveLength(1);
    expect(result.meta.has_more).toBe(false);
  });

  it('includes cursor when provided', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockOrganisationsResponse);
    await getOrganisations('cursor-org-1');
    expect(api.get).toHaveBeenCalledWith('/api/v2/volunteering/organisations', { cursor: 'cursor-org-1' });
  });

  it('omits cursor when null', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockOrganisationsResponse);
    await getOrganisations(null);
    const call = (api.get as jest.Mock).mock.calls[0][1] as Record<string, string>;
    expect(call).not.toHaveProperty('cursor');
  });

  it('includes search param when provided', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockOrganisationsResponse);
    await getOrganisations(null, 'care');
    expect(api.get).toHaveBeenCalledWith('/api/v2/volunteering/organisations', { search: 'care' });
  });

  it('omits search when not provided', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockOrganisationsResponse);
    await getOrganisations(null);
    const call = (api.get as jest.Mock).mock.calls[0][1] as Record<string, string>;
    expect(call).not.toHaveProperty('search');
  });

  it('includes cursor and search together', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockOrganisationsResponse);
    await getOrganisations('cursor-3', 'housing');
    expect(api.get).toHaveBeenCalledWith('/api/v2/volunteering/organisations', {
      cursor: 'cursor-3',
      search: 'housing',
    });
  });
});

describe('getOrganisation', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('calls the correct endpoint with the organisation ID', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: mockOrganisation });
    const result = await getOrganisation(5);
    expect(api.get).toHaveBeenCalledWith('/api/v2/volunteering/organisations/5');
    expect(result.data.name).toBe('Community Care Ltd');
    expect(result.data.verified).toBe(true);
  });
});

describe('createOrganisation', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('posts the registration payload to the organisation endpoint', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: mockOrganisation });
    const payload = {
      name: 'Community Care Ltd',
      description: 'A care-focused community organisation.',
      contact_email: 'hello@example.org',
      website: 'https://communitycare.example',
    };

    const result = await createOrganisation(payload);

    expect(api.post).toHaveBeenCalledWith('/api/v2/volunteering/organisations', payload);
    expect(result.data.name).toBe('Community Care Ltd');
  });

  it('sends the creation idempotency key in the request header and body', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: mockOrganisation });
    const payload = {
      name: 'Community Care Ltd',
      description: 'A care-focused community organisation.',
      contact_email: 'hello@example.org',
      idempotency_key: 'organisation-attempt-123',
    };

    await createOrganisation(payload);

    expect(api.post).toHaveBeenCalledWith('/api/v2/volunteering/organisations', payload, {
      headers: { 'Idempotency-Key': 'organisation-attempt-123' },
    });
  });
});
