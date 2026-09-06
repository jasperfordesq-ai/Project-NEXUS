// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn(), upload: jest.fn() },
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
jest.mock('@/lib/storage', () => ({
  storage: { get: jest.fn() },
}));

import { api, ApiResponseError } from '@/lib/api/client';
import { storage } from '@/lib/storage';
import { updateProfile, updatePassword, updateAvatar } from './profile';
import type { UpdateProfilePayload, UpdatePasswordPayload } from './profile';

const mockUser = {
  id: 1,
  name: 'Alice Smith',
  first_name: 'Alice',
  last_name: 'Smith',
  email: 'alice@example.com',
  avatar_url: null,
  bio: null,
  location: null,
  phone: null,
  balance: 5,
  role: 'member',
  tenant_id: 2,
  created_at: '2025-06-01T00:00:00Z',
};

describe('updateProfile', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('sends PUT with the payload to /api/v2/users/me', async () => {
    (api.put as jest.Mock).mockResolvedValue({ data: mockUser });
    const payload: UpdateProfilePayload = { first_name: 'Alice', bio: 'Hello' };
    const result = await updateProfile(payload);
    expect(api.put).toHaveBeenCalledWith('/api/v2/users/me', payload);
    expect(result.data.name).toBe('Alice Smith');
  });

  it('sends PUT with partial payload correctly', async () => {
    (api.put as jest.Mock).mockResolvedValue({ data: mockUser });
    await updateProfile({ location: 'Dublin' });
    expect(api.put).toHaveBeenCalledWith('/api/v2/users/me', { location: 'Dublin' });
  });

  it('propagates errors from the API', async () => {
    (api.put as jest.Mock).mockRejectedValue(new Error('Validation error'));
    await expect(updateProfile({ bio: '' })).rejects.toThrow('Validation error');
  });
});

describe('updatePassword', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('sends POST with the full password payload to /api/v2/users/me/password', async () => {
    (api.post as jest.Mock).mockResolvedValue(undefined);
    const payload: UpdatePasswordPayload = {
      current_password: 'oldpass',
      new_password: 'newpass1',
      new_password_confirmation: 'newpass1',
    };
    await updatePassword(payload);
    expect(api.post).toHaveBeenCalledWith('/api/v2/users/me/password', payload);
  });

  it('propagates errors from the API', async () => {
    (api.post as jest.Mock).mockRejectedValue(new Error('Wrong password'));
    await expect(
      updatePassword({ current_password: 'x', new_password: 'y', new_password_confirmation: 'y' }),
    ).rejects.toThrow('Wrong password');
  });
});

describe('updateAvatar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (storage.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'auth_token') return Promise.resolve('test-token');
      if (key === 'tenant_slug') return Promise.resolve('test-tenant');
      return Promise.resolve(null);
    });
  });

  it('uses fetch to POST multipart form data to /api/v2/users/me/avatar', async () => {
    (api.upload as jest.Mock).mockResolvedValue({ data: { avatar_url: 'https://cdn.example.com/avatar.jpg' } });

    const result = await updateAvatar('file:///local/path/avatar.jpg');

    expect(api.upload).toHaveBeenCalledWith('/api/v2/users/me/avatar', expect.any(FormData));
    expect(result.data.avatar_url).toBe('https://cdn.example.com/avatar.jpg');
  });

  it('normalizes a flat avatar upload response', async () => {
    (api.upload as jest.Mock).mockResolvedValue({ avatar_url: '/uploads/avatars/new.webp' });

    const result = await updateAvatar('file:///local/path/avatar.jpg');

    expect(result.data.avatar_url).toBe('/uploads/avatars/new.webp');
  });

  it('throws when the upload response has no avatar URL', async () => {
    (api.upload as jest.Mock).mockResolvedValue({ success: true, data: {} });

    await expect(updateAvatar('file:///any.jpg')).rejects.toThrow('did not return the file');
  });

  it('propagates upload failures from the API client', async () => {
    (api.upload as jest.Mock).mockRejectedValue(new ApiResponseError(422, 'Invalid file type'));

    await expect(updateAvatar('file:///any.jpg')).rejects.toMatchObject({
      status: 422,
      message: 'Invalid file type',
    });
  });
});
