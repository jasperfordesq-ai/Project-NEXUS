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

import { api } from '@/lib/api/client';
import {
  MEMBER_REPORT_CATEGORIES,
  MEMBER_REPORT_DETAILS_MAX,
  memberReportDetailsProblem,
  reportMember,
  reportMessage,
} from './memberReports';

describe('member reports API', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('lists the six categories the server accepts, in order', () => {
    expect(MEMBER_REPORT_CATEGORIES).toEqual([
      'safeguarding_concern', 'harassment', 'inappropriate', 'scam_or_fraud', 'spam', 'other',
    ]);
    expect(MEMBER_REPORT_DETAILS_MAX).toBe(2000);
  });

  it('posts a member report to /users/{id}/report', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { reported: true, report_id: 9 } });
    const result = await reportMember(42, { category: 'harassment', details: 'Repeated calls' });
    expect(api.post).toHaveBeenCalledWith('/api/v2/users/42/report', { category: 'harassment', details: 'Repeated calls' });
    expect(result.data.report_id).toBe(9);
  });

  it('posts a message report to /messages/{id}/report', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { reported: true, report_id: 3 } });
    await reportMessage(7, { category: 'spam' });
    expect(api.post).toHaveBeenCalledWith('/api/v2/messages/7/report', { category: 'spam' });
  });

  it('trims details and leaves out empty details', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { reported: true, report_id: 1 } });
    await reportMember(5, { category: 'spam', details: '   ' });
    expect(api.post).toHaveBeenCalledWith('/api/v2/users/5/report', { category: 'spam' });
    await reportMessage(6, { category: 'other', details: '  Something odd  ' });
    expect(api.post).toHaveBeenLastCalledWith('/api/v2/messages/6/report', { category: 'other', details: 'Something odd' });
  });

  it('propagates a refusal', async () => {
    (api.post as jest.Mock).mockRejectedValue(new Error('Already reported'));
    await expect(reportMember(1, { category: 'spam' })).rejects.toThrow('Already reported');
  });

  it('checks details the way the server does', () => {
    expect(memberReportDetailsProblem('other', '')).toBe('required');
    expect(memberReportDetailsProblem('other', '   ')).toBe('required');
    expect(memberReportDetailsProblem('other', 'Context')).toBeNull();
    expect(memberReportDetailsProblem('spam', '')).toBeNull();
    expect(memberReportDetailsProblem('spam', 'x'.repeat(2001))).toBe('tooLong');
    expect(memberReportDetailsProblem('spam', 'x'.repeat(2000))).toBeNull();
  });
});
