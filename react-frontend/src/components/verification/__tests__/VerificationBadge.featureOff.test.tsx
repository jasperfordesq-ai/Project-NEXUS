// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Regression (AWID pilot, Oct 2026): a community that switched identity
 * verification off still showed "Verified" / "Not ID verified" badges on
 * profiles, listings, messages and member cards. Only the navbar honoured the
 * `identity_verification` feature switch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), download: vi.fn(), upload: vi.fn() },
}));
vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn((key: string) => key !== 'identity_verification'),
      hasModule: vi.fn(() => true),
    }),
  } as unknown as Parameters<typeof createMockContexts>[0]),
);
vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

import {
  VerificationBadgeIcon,
  VerificationBadgeRow,
  VerificationBadgeSummary,
} from '../VerificationBadge';

const idBadge = { type: 'id_verified', label: 'ID Verified' };
const emailBadge = { type: 'email_verified', label: 'Email Verified' };

describe('verification badges when the community has identity verification off', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: [idBadge, emailBadge] });
  });

  it('shows no badge row and no "Not ID verified" chip', () => {
    const { container } = render(<VerificationBadgeRow badges={[emailBadge]} />);
    expect(screen.queryByText(/not id verified/i)).not.toBeInTheDocument();
    expect(container.textContent).toBe('');
  });

  it('does not fetch a member\'s badges at all', () => {
    render(<VerificationBadgeRow userId={42} />);
    render(<VerificationBadgeSummary userId={42} />);
    expect(mockApi.get).not.toHaveBeenCalled();
  });

  it('shows no compact verified icon', () => {
    render(<VerificationBadgeIcon badge={idBadge} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
