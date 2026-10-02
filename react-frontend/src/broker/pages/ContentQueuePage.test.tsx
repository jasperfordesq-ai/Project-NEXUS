// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const { mockQueue } = vi.hoisted(() => ({
  mockQueue: vi.fn(),
}));

// The stand-in admin module reports whether it was rendered inside the
// AdminEmbed provider — that flag is what collapses its PageHeader.
vi.mock('@/admin/modules/reports/ModerationQueuePage', async () => {
  const { useAdminEmbedded } = await import('@/admin/components/AdminEmbedContext');
  return {
    __esModule: true,
    default: () => {
      mockQueue();
      return <div data-testid="admin-content-queue" data-embedded={String(useAdminEmbedded())} />;
    },
  };
});

const mockUser = vi.hoisted(() => ({ current: { id: 1, role: 'broker' } as Record<string, unknown> }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({ user: mockUser.current }),
  }),
);

describe('ContentQueuePage (broker)', () => {
  it('frames the admin content queue in the broker shell', async () => {
    mockUser.current = { id: 1, role: 'broker' };
    const Component = (await import('./ContentQueuePage')).default;
    render(<Component />);

    expect(screen.getByRole('heading', { level: 1, name: 'Content Queue' })).toBeInTheDocument();
    expect(screen.getByTestId('admin-content-queue')).toBeInTheDocument();
  });

  // F-543 (2 Oct 2026): moderation settings are broker-or-admin, so nothing
  // may hide the embedded page's Settings button from brokers any more. The
  // module simply renders inside the AdminEmbed provider.
  it('renders the queue inside the AdminEmbed provider with nothing hidden for brokers', async () => {
    mockUser.current = { id: 1, role: 'broker' };
    const Component = (await import('./ContentQueuePage')).default;
    render(<Component />);

    const queue = screen.getByTestId('admin-content-queue');
    expect(queue).toHaveAttribute('data-embedded', 'true');
    expect(queue.parentElement?.className ?? '').not.toContain('hidden');
  });

  it('links to the plain-English guide for this page', async () => {
    const Component = (await import('./ContentQueuePage')).default;
    render(<Component />);

    expect(screen.getByRole('link', { name: 'How this page works' })).toHaveAttribute(
      'href',
      expect.stringContaining('/broker/help/broker_moderation/broker_content_queue'),
    );
  });
});
