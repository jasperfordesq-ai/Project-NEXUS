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
vi.mock('@/admin/modules/safeguarding/SafeguardingOptionsAdmin', async () => {
  const { useAdminEmbedded } = await import('@/admin/components/AdminEmbedContext');
  return {
    __esModule: true,
    default: () => {
      mockAdmin();
      return <div data-testid="admin-safeguarding-options" data-embedded={String(useAdminEmbedded())} />;
    },
  };
});

vi.mock('@/contexts', () => createMockContexts());

describe('SafeguardingOptionsPage (broker)', () => {
  it('frames the admin module in the broker shell with broker-namespace copy', async () => {
    const Component = (await import('./SafeguardingOptionsPage')).default;
    render(<Component />);

    expect(screen.getByRole('heading', { level: 1, name: 'Safeguarding Options' })).toBeInTheDocument();
    expect(screen.getByText('Configure the safeguarding declaration options members can select.')).toBeInTheDocument();
    expect(screen.getByTestId('admin-safeguarding-options')).toBeInTheDocument();
    expect(mockAdmin).toHaveBeenCalledTimes(1);
  });

  it('renders the admin module inside the AdminEmbed provider so its own header collapses', async () => {
    const Component = (await import('./SafeguardingOptionsPage')).default;
    render(<Component />);

    expect(screen.getByTestId('admin-safeguarding-options')).toHaveAttribute('data-embedded', 'true');
  });

  it('links to the plain-English guide for this page', async () => {
    const Component = (await import('./SafeguardingOptionsPage')).default;
    render(<Component />);

    expect(screen.getByRole('link', { name: 'How this page works' })).toHaveAttribute(
      'href',
      expect.stringContaining('/broker/help/'),
    );
  });
});
