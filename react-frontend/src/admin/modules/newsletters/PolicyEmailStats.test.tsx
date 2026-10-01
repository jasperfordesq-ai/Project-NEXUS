// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const { mockAdminLegalDocs } = vi.hoisted(() => ({
  mockAdminLegalDocs: { emailStats: vi.fn() },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return { ...orig, useNavigate: () => vi.fn(), useParams: () => ({ versionId: '11' }) };
});

vi.mock('../../api/adminApi', () => ({ adminLegalDocs: mockAdminLegalDocs }));

import { PolicyEmailStats } from './PolicyEmailStats';

const row = (id: number, email: string, status: string) => ({
  id, email, first_name: null, status, sent_at: null,
  first_opened: null, first_clicked: null, opens: 0, clicks: 0,
});

describe('PolicyEmailStats', () => {
  beforeEach(() => {
    mockAdminLegalDocs.emailStats.mockResolvedValue({
      success: true,
      data: {
        version: { title: 'Privacy Policy', version_number: '2.0', published_at: null },
        totals: { recipients: 3, submitted: 1, total_opens: 0, unique_opens: 0, total_clicks: 0, unique_clicks: 0 },
        recipients: [
          row(1, 'sent@example.test', 'sent'),
          row(2, 'blocked@example.test', 'suppressed'),
          row(3, 'odd@example.test', 'some_future_state'),
        ],
        meta: { total: 3, page: 1, per_page: 50, total_pages: 1 },
      },
    });
  });

  it('shows each delivery state as a translated label, never the raw ledger value', async () => {
    render(<PolicyEmailStats />);

    expect(await screen.findByText('sent@example.test')).toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.getByText('Blocked by delivery suppression')).toBeInTheDocument();
    // A state the page does not know yet reads as "Outcome unknown", not as the raw word.
    expect(screen.getByText('Outcome unknown')).toBeInTheDocument();
    expect(screen.queryByText('some_future_state')).not.toBeInTheDocument();
    expect(screen.queryByText('suppressed')).not.toBeInTheDocument();
  });
});
