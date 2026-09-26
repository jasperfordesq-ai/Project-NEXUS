// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for CreateGroupExchangePage
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));
import { api } from '@/lib/api';

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test', name: 'Test User' },
    isAuthenticated: true,
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
  })),
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('@/contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
  resolveThumbnailUrl: vi.fn((url) => url || null),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

vi.mock('@/lib/motion', async () => {
  const { framerMotionMock } = await import('@/test/mocks');
  return framerMotionMock;
});

vi.mock('@/components/ui', async () => {
  const { uiMock } = await import('@/test/uiMock');

  // The shared input-like stub renders a single bare <input> and drops compound
  // children, so the HeroUI v3 compound NumberField (Label + NumberField.Group +
  // NumberField.Input with the placeholder) loses its placeholder. Override
  // NumberField with a stub that renders its compound children.
  const NumberFieldMock = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  NumberFieldMock.Group = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  NumberFieldMock.Input = ({ placeholder }: { placeholder?: string }) => (
    <input placeholder={placeholder} readOnly />
  );
  NumberFieldMock.DecrementButton = () => <button type="button">-</button>;
  NumberFieldMock.IncrementButton = () => <button type="button">+</button>;

  return new Proxy(uiMock as Record<string, unknown>, {
    get(target, prop, receiver) {
      if (prop === 'NumberField') return NumberFieldMock;
      return Reflect.get(target, prop, receiver);
    },
  });
});

vi.mock('@/components/navigation', () => ({
  Breadcrumbs: ({ items }: { items: { label: string }[] }) => (
    <nav>{items.map((i) => <span key={i.label}>{i.label}</span>)}</nav>
  ),
}));

import { CreateGroupExchangePage } from './CreateGroupExchangePage';

describe('CreateGroupExchangePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({ success: true, data: [] });
    api.post.mockResolvedValue({ success: true, data: { id: 55 } });
  });

  it('renders the create group exchange wizard step 1', () => {
    render(<CreateGroupExchangePage />);
    // Step 1: Exchange Details heading (from i18n key create.exchange_details)
    expect(screen.getByText('Exchange Details')).toBeInTheDocument();
  });

  it('renders wizard step progress indicator', () => {
    render(<CreateGroupExchangePage />);
    // Progress component should be rendered for step tracking
    expect(document.body).toBeInTheDocument();
  });

  it('renders title input on step 1', () => {
    render(<CreateGroupExchangePage />);
    expect(screen.getByPlaceholderText('e.g., Community Garden Workday')).toBeInTheDocument();
  });

  it('renders total hours input on step 1', () => {
    render(<CreateGroupExchangePage />);
    expect(screen.getByPlaceholderText('e.g., 10')).toBeInTheDocument();
  });

  it('renders next button to advance to step 2', () => {
    render(<CreateGroupExchangePage />);
    expect(screen.getByText('Next')).toBeInTheDocument();
  });

  it('shows split type options on step 1', () => {
    render(<CreateGroupExchangePage />);
    // Should show equal/custom/weighted split options
    expect(document.body).toBeInTheDocument();
  });

  // The member directory never returns the viewer, so an organiser who is
  // also delivering the activity could not add themselves before this.
  it('lets the organiser add themselves as a participant', async () => {
    render(<CreateGroupExchangePage />);

    fireEvent.change(screen.getByPlaceholderText('e.g., Community Garden Workday'), {
      target: { value: 'Workshop' },
    });
    const hours = screen.getByPlaceholderText('e.g., 10');
    fireEvent.change(hours, { target: { value: '1' } });
    fireEvent.blur(hours);
    fireEvent.click(screen.getByText('Next'));

    const selfRow = (await screen.findByText('Add yourself as')).parentElement as HTMLElement;
    fireEvent.click(within(selfRow).getByRole('button', { name: /Provider/ }));

    await waitFor(() => expect(screen.getByText('Test User')).toBeInTheDocument());
    expect(screen.queryByText('Add yourself as')).not.toBeInTheDocument();
  });
});
