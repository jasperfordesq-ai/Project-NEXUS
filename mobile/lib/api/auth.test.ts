// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Mock transitive deps so auth.ts module can load
jest.mock('@/lib/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn() },
  ApiResponseError: class ApiResponseError extends Error {
    status!: number;
    constructor(status: number, message: string) { super(message); this.status = status; this.name = 'ApiResponseError'; }
  },
  registerUnauthorizedCallback: jest.fn(),
}));
jest.mock('@/lib/constants', () => ({
  API_V2: '/api/v2',
  API_BASE_URL: 'https://test.api',
  STORAGE_KEYS: {
    AUTH_TOKEN: 'auth_token',
    REFRESH_TOKEN: 'refresh_token',
    TENANT_SLUG: 'tenant_slug',
    USER_DATA: 'user_data',
  },
  // API_REGISTER must be present here: registration passes it explicitly, and a mock
  // that omitted it would let `timeout: undefined` through unnoticed.
  TIMEOUTS: { API_REQUEST: 15_000, API_REGISTER: 45_000 },
  DEFAULT_TENANT: 'test-tenant',
}));

import { api } from '@/lib/api/client';
import {
  buildDisplayName,
  extractToken,
  getRegistrationResult,
  register,
  resetPassword,
  verifyEmail,
} from './auth';
import type { AuthResponse, LoginUser, RegisterPayload, RegisterResponse } from './auth';

const baseResponse: AuthResponse = {
  success: true,
  access_token: '',
  refresh_token: 'ref_token',
  token_type: 'Bearer',
  expires_in: 3600,
  user: {
    id: 1,
    first_name: 'Jane',
    last_name: 'Smith',
    email: 'jane@example.com',
    avatar_url: null,
    tenant_id: 1,
    role: 'member',
    is_admin: false,
    onboarding_completed: true,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('extractToken', () => {
  it('returns access_token when present', () => {
    const response: AuthResponse = { ...baseResponse, access_token: 'tok_primary' };
    expect(extractToken(response)).toBe('tok_primary');
  });

  it('falls back to legacy token field when access_token is absent', () => {
    // The server may omit access_token; ?? only falls back on null/undefined
    const response = { ...baseResponse, access_token: undefined as unknown as string, token: 'tok_legacy' };
    expect(extractToken(response)).toBe('tok_legacy');
  });

  it('throws when neither token field is set', () => {
    const response = { ...baseResponse, access_token: undefined as unknown as string, token: undefined };
    expect(() => extractToken(response)).toThrow('Unable to sign in. Please try again.');
  });

  it('returns empty-string access_token when that is the actual value', () => {
    // Empty string is falsy but still a string — extractToken should throw since '' is falsy
    const response: AuthResponse = { ...baseResponse, access_token: '' };
    expect(() => extractToken(response)).toThrow('Unable to sign in. Please try again.');
  });
});

describe('buildDisplayName', () => {
  const base: LoginUser = {
    id: 1,
    first_name: null,
    last_name: null,
    email: 'jane@example.com',
    avatar_url: null,
    tenant_id: 1,
    role: 'member',
    is_admin: false,
    onboarding_completed: true,
  };

  it('returns full name when both parts are set', () => {
    expect(buildDisplayName({ ...base, first_name: 'Jane', last_name: 'Smith' })).toBe('Jane Smith');
  });

  it('returns first name only when last name is null', () => {
    expect(buildDisplayName({ ...base, first_name: 'Jane', last_name: null })).toBe('Jane');
  });

  it('returns last name only when first name is null', () => {
    expect(buildDisplayName({ ...base, first_name: null, last_name: 'Smith' })).toBe('Smith');
  });

  it('returns "Member" when both names are null', () => {
    expect(buildDisplayName({ ...base, first_name: null, last_name: null })).toBe('Member');
  });
});

describe('register', () => {
  it('posts all backend-required registration fields to the V2 endpoint', async () => {
    const payload: RegisterPayload = {
      first_name: 'Mobile',
      last_name: 'Member',
      email: 'mobile.member@example.test',
      password: 'TestPassword123!',
      password_confirmation: 'TestPassword123!',
      location: 'City, country',
      phone: '+1 555 123 4567',
      terms_accepted: true,
      form_started_at: 1_780_665_000_000,
    };
    const response: RegisterResponse = {
      data: {
        user: { id: 2, first_name: 'Mobile', last_name: 'Member', email: 'mobile.member@example.test' },
        requires_verification: true,
        message: 'Check your email before signing in.',
      },
    };
    (api.post as jest.Mock).mockResolvedValue(response);

    await expect(register(payload)).resolves.toBe(response);

    // 🔴 The explicit timeout is part of the contract, not incidental. Registration does an
    // MX lookup and a breach-database check before answering; on 2026-08-22 the ordinary
    // 15s mutation timeout fired on a request the server completed, and the member was told
    // their account had not been created when it had.
    expect(api.post).toHaveBeenCalledWith('/api/v2/auth/register', payload, { timeout: 45_000 });
  });
});

describe('getRegistrationResult', () => {
  it('unwraps Laravel V2 response envelopes', () => {
    const result = {
      user: { id: 2, first_name: 'Mobile', last_name: 'Member', email: 'mobile.member@example.test' },
      requires_verification: true,
      message: 'Check your email before signing in.',
    };

    expect(getRegistrationResult({ data: result })).toBe(result);
  });

  it('returns legacy flat registration responses unchanged', () => {
    expect(getRegistrationResult(baseResponse)).toBe(baseResponse);
  });
});

describe('resetPassword', () => {
  it('posts the reset token and password confirmation to the auth endpoint', async () => {
    (api.post as jest.Mock).mockResolvedValue({ success: true });

    await resetPassword({
      token: 'reset-token',
      password: 'NewPassw0rd!',
      password_confirmation: 'NewPassw0rd!',
    });

    expect(api.post).toHaveBeenCalledWith('/api/auth/reset-password', {
      token: 'reset-token',
      password: 'NewPassw0rd!',
      password_confirmation: 'NewPassw0rd!',
    });
  });
});

describe('verifyEmail', () => {
  it('posts the email verification token to the auth endpoint', async () => {
    (api.post as jest.Mock).mockResolvedValue({ success: true, data: { verified: true } });

    await verifyEmail('verify-token');

    expect(api.post).toHaveBeenCalledWith('/api/auth/verify-email', { token: 'verify-token' });
  });
});
