// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import MunicipalSurveyAdminPage from '../MunicipalSurveyAdminPage';
import MunicipalityFeedbackAdminPage from '../MunicipalityFeedbackAdminPage';

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  download: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: apiMock,
  default: apiMock,
}));

vi.mock('@/contexts', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'tenant_admin' },
    isAuthenticated: true,
  }),
  useToast: () => ({
    showToast: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemoryRouter>{children}</MemoryRouter>
    </>
  );
}

describe('Caring admin CSV exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.download.mockResolvedValue(new Blob(['ok']));
    apiMock.post.mockResolvedValue({ success: true, data: {} });
    apiMock.put.mockResolvedValue({ success: true, data: {} });
  });

  it('exports municipal survey responses with the survey id in the filename', async () => {
    apiMock.get.mockResolvedValueOnce({
      success: true,
      // GET /v2/admin/caring-community/surveys sends a bare array (respondWithData),
      // which the shared api client (src/lib/api.ts) resolves as `data: [rows]`.
      // An earlier fixture nested the rows inside `data`, a shape it never produces.
      data: [
        {
          id: 42,
          title: 'Resident Pulse',
          status: 'active',
          is_anonymous: true,
          question_count: 3,
          response_count: 9,
          starts_at: null,
          ends_at: null,
          created_at: '2026-05-01T00:00:00Z',
        },
      ],
    });

    render(<Wrapper><MunicipalSurveyAdminPage /></Wrapper>);

    await userEvent.click(await screen.findByRole('button', { name: 'CSV' }));

    expect(apiMock.download).toHaveBeenCalledWith(
      '/v2/admin/caring-community/surveys/42/export',
      { filename: 'survey-42-resident-pulse.csv' },
    );
  });

  it('exports municipality feedback with active filters', async () => {
    apiMock.get
      .mockResolvedValueOnce({
        success: true,
        data: {
          total_open: 0,
          by_status: {},
          by_category: {},
          by_sub_region: {},
          recent_count_7d: 0,
          sentiment_distribution: {},
        },
      })
      .mockResolvedValueOnce({ success: true, data: [], meta: { current_page: 1, per_page: 25, total: 0, total_pages: 1, has_more: false } });

    render(<Wrapper><MunicipalityFeedbackAdminPage /></Wrapper>);

    await userEvent.click(await screen.findByRole('button', { name: 'Export CSV' }));

    await waitFor(() => {
      expect(apiMock.download).toHaveBeenCalledWith(
        '/v2/admin/caring-community/feedback/export.csv',
        { filename: 'municipality-feedback-export.csv' },
      );
    });
  });
});
