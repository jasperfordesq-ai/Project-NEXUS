// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';

import { createMockContexts } from '@/test/mock-contexts';

const { mockAdmin } = vi.hoisted(() => ({
  mockAdmin: vi.fn(),
}));

// The stand-in admin module reports whether it was rendered inside the
// AdminEmbed provider — that flag is what collapses its PageHeader.
vi.mock('@/admin/modules/moderation/ReportsManagement', async () => {
  const { useAdminEmbedded } = await import('@/admin/components/AdminEmbedContext');
  return {
    __esModule: true,
    default: () => {
      mockAdmin();
      return <div data-testid="admin-reports-management" data-embedded={String(useAdminEmbedded())} />;
    },
  };
});

vi.mock('@/contexts', () => createMockContexts());

describe('ReportsPage (broker)', () => {
  it('frames the admin module in the broker shell with broker-namespace copy', async () => {
    const Component = (await import('./ReportsPage')).default;
    render(<Component />);

    expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeInTheDocument();
    expect(screen.getByText('Triage and resolve member reports about content and other members.')).toBeInTheDocument();
    expect(screen.getByTestId('admin-reports-management')).toBeInTheDocument();
    expect(mockAdmin).toHaveBeenCalledTimes(1);
  });

  it('renders the admin module inside the AdminEmbed provider so its own header collapses', async () => {
    const Component = (await import('./ReportsPage')).default;
    render(<Component />);

    expect(screen.getByTestId('admin-reports-management')).toHaveAttribute('data-embedded', 'true');
  });

  it('links to the plain-English guide for this page', async () => {
    const Component = (await import('./ReportsPage')).default;
    render(<Component />);

    expect(screen.getByRole('link', { name: 'How this page works' })).toHaveAttribute(
      'href',
      expect.stringContaining('/broker/help/'),
    );
  });
});
