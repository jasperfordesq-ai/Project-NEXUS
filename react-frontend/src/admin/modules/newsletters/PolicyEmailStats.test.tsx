// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

const { mockEmailStats } = vi.hoisted(() => ({ mockEmailStats: vi.fn() }));
vi.mock('../../api/adminApi', () => ({ adminLegalDocs: { emailStats: mockEmailStats } }));
vi.mock('@/contexts', () => createMockContexts());
vi.mock('react-router-dom', async (original) => {
  const actual = await original<typeof import('react-router-dom')>();
  return { ...actual, useParams: () => ({ versionId: '9' }) };
});

import { PolicyEmailStats } from './PolicyEmailStats';

describe('PolicyEmailStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmailStats.mockResolvedValue({ success: true, data: {
      version: { title: 'Privacy policy', version_number: '2.0', published_at: '2026-09-30T20:00:00Z' },
      totals: { recipients: 10, submitted: 8, unique_opens: 3, total_opens: 5, unique_clicks: 2, total_clicks: 4 },
      recipients: [{ id: 1, email: 'reader@example.org', first_name: 'Reader', status: 'sent', sent_at: null, first_opened: '2026-09-30T21:00:00Z', first_clicked: null, opens: 2, clicks: 0 }],
      meta: { total: 1, page: 1, per_page: 25, total_pages: 1 },
    } });
  });

  it('shows unique and total activity plus the recipient and filters', async () => {
    render(<PolicyEmailStats />);
    expect(await screen.findByText('reader@example.org')).toBeInTheDocument();
    expect(screen.getByText('5 opens in total')).toBeInTheDocument();
    expect(screen.getByText('4 clicks in total')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clicked' }));
    await waitFor(() => expect(mockEmailStats).toHaveBeenLastCalledWith(9, 1, 'clicked'));
  });
});
