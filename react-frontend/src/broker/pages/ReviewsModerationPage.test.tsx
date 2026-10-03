// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';

import { createMockContexts } from '@/test/mock-contexts';

const { mockAdmin, titleEffects } = vi.hoisted(() => ({
  mockAdmin: vi.fn(),
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
vi.mock('@/admin/modules/moderation/ReviewsModeration', async () => {
  const { useAdminEmbedded } = await import('@/admin/components/AdminEmbedContext');
  const { usePageTitle } = await import('@/hooks');
  return {
    __esModule: true,
    default: () => {
      mockAdmin();
      usePageTitle('Admin: Reviews Moderation');
      return <div data-testid="admin-reviews-moderation" data-embedded={String(useAdminEmbedded())} />;
    },
  };
});

vi.mock('@/contexts', () => createMockContexts());

describe('ReviewsModerationPage (broker)', () => {
  it('frames the admin module in the broker shell with broker-namespace copy', async () => {
    const Component = (await import('./ReviewsModerationPage')).default;
    render(<Component />);

    expect(screen.getByRole('heading', { level: 1, name: 'Reviews Moderation' })).toBeInTheDocument();
    expect(screen.getByText('Review, flag, and moderate member reviews.')).toBeInTheDocument();
    expect(screen.getByTestId('admin-reviews-moderation')).toBeInTheDocument();
    expect(mockAdmin).toHaveBeenCalledTimes(1);
  });

  it('renders the admin module inside the AdminEmbed provider so its own header collapses', async () => {
    const Component = (await import('./ReviewsModerationPage')).default;
    render(<Component />);

    expect(screen.getByTestId('admin-reviews-moderation')).toHaveAttribute('data-embedded', 'true');
  });

  it('sets its own browser-tab title after the embedded module sets its', async () => {
    titleEffects.length = 0;
    const Component = (await import('./ReviewsModerationPage')).default;
    render(<Component />);

    expect(titleEffects).toContain('Admin: Reviews Moderation');
    expect(titleEffects[titleEffects.length - 1]).toBe('Reviews Moderation');
  });

  it('links to the plain-English guide for this page', async () => {
    const Component = (await import('./ReviewsModerationPage')).default;
    render(<Component />);

    expect(screen.getByRole('link', { name: 'How this page works' })).toHaveAttribute(
      'href',
      expect.stringContaining('/broker/help/'),
    );
  });
});
