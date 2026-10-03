// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const { mockQueue, titleEffects } = vi.hoisted(() => ({
  mockQueue: vi.fn(),
  titleEffects: [] as string[],
}));

// usePageTitle is an effect in the real hook; record the order the effects
// commit in, which is what decides whose title the browser tab ends up with.
vi.mock('@/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks')>();
  const { useEffect } = await import('react');
  return {
    ...actual,
    usePageTitle: (title: string) => {
      useEffect(() => {
        titleEffects.push(title);
      }, [title]);
    },
  };
});

// The stand-in admin module reports whether it was rendered inside the
// AdminEmbed provider — that flag is what collapses its PageHeader — and,
// like the real module, sets its own page title.
vi.mock('@/admin/modules/reports/ModerationQueuePage', async () => {
  const { useAdminEmbedded } = await import('@/admin/components/AdminEmbedContext');
  const { usePageTitle } = await import('@/hooks');
  return {
    __esModule: true,
    default: () => {
      mockQueue();
      usePageTitle('Admin: Moderation Queue');
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

  // The four moderation wrappers used to share whatever title the embedded
  // admin module set. The wrapper's own title must be the last one applied.
  it('sets its own browser-tab title after the embedded module sets its', async () => {
    titleEffects.length = 0;
    const Component = (await import('./ContentQueuePage')).default;
    render(<Component />);

    expect(titleEffects).toContain('Admin: Moderation Queue');
    expect(titleEffects[titleEffects.length - 1]).toBe('Content Queue');
    expect(titleEffects.indexOf('Admin: Moderation Queue')).toBeLessThan(titleEffects.indexOf('Content Queue'));
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
