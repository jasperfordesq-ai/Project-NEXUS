// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, userEvent } from '@/test/test-utils';
import { api } from '@/lib/api';
import type { ReactNode } from 'react';

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: { children?: ReactNode; [k: string]: unknown }) => {
      const { variants: _v, initial: _i, animate: _a, exit: _e, transition: _t, ...rest } = props as Record<string, unknown>;
      return <div {...rest}>{children}</div>;
    },
    ul: ({ children, ...props }: { children?: ReactNode; [k: string]: unknown }) => {
      const { variants: _v, initial: _i, animate: _a, ...rest } = props as Record<string, unknown>;
      return <ul {...rest}>{children}</ul>;
    },
    li: ({ children, ...props }: { children?: ReactNode; [k: string]: unknown }) => {
      const { variants: _v, initial: _i, animate: _a, ...rest } = props as Record<string, unknown>;
      return <li {...rest}>{children}</li>;
    },
  },
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, opts?: Record<string, unknown>) =>
      (opts?.fallbackValue as string | undefined) ?? key,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await import('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test', name: 'Test User', role: 'member' },
    isAuthenticated: true,
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  })),

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

// FederationMessagesPage imports usePusherOptional from '@/contexts/PusherContext' directly,
// so the barrel override above is dead — vitest resolves mocks per specifier. Without this the
// real PusherContext loads, along with its own direct '@/contexts/AuthContext' import.
vi.mock('@/contexts/PusherContext', () => ({
  usePusherOptional: () => null,
  usePusher: () => ({ channel: null, isConnected: false }),
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantSlug: 'test',
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

// scrollIntoView is not implemented in jsdom. FederationMessagesPage scrolls the thread to the
// bottom from inside a setTimeout, so the call lands after the test that opened the thread has
// finished — vitest reports it as an unhandled error and exits non-zero even with every assertion
// passing. Same polyfill as TeamChatrooms.test.tsx.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (url: string | null) => url ?? '',
  formatRelativeTime: (d: string) => d,
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

import { FederationMessagesPage } from './FederationMessagesPage';

const mockMessage = {
  id: 1,
  subject: 'Hello from Cork!',
  body: 'Hi there, would love to connect.',
  direction: 'inbound' as const,
  status: 'unread' as const,
  created_at: '2026-03-01T10:00:00Z',
  sender: {
    id: 20,
    name: 'Maria Green',
    avatar: null,
    tenant_id: 5,
    tenant_name: 'Cork Timebank',
  },
  receiver: {
    id: 1,
    name: 'Test User',
    avatar: null,
    tenant_id: 2,
    tenant_name: 'Test Tenant',
  },
};

describe('FederationMessagesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<FederationMessagesPage />);
    expect(document.body).toBeTruthy();
  });

  it('renders conversation thread list on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [mockMessage] });
    render(<FederationMessagesPage />);
    await waitFor(() => {
      expect(screen.getByText('Maria Green')).toBeInTheDocument();
    });
    expect(screen.getByText('Cork Timebank')).toBeInTheDocument();
  });

  it('shows message body preview in thread list', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [mockMessage] });
    render(<FederationMessagesPage />);
    await waitFor(() => {
      expect(screen.getByText('Hi there, would love to connect.')).toBeInTheDocument();
    });
  });

  it('shows empty threads state when no messages exist', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<FederationMessagesPage />);
    await waitFor(() => {
      expect(screen.getByText('messages.no_messages_yet')).toBeInTheDocument();
    });
  });

  it('shows compose new message button', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<FederationMessagesPage />);
    await waitFor(() => {
      expect(screen.getByText('messages.compose')).toBeInTheDocument();
    });
  });

  it('calls the correct API endpoint on mount', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<FederationMessagesPage />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/v2/federation/messages', expect.objectContaining({
        signal: expect.any(AbortSignal),
      }));
    });
  });

  it('shows unread badge on threads with unread messages', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [mockMessage] });
    render(<FederationMessagesPage />);
    await waitFor(() => {
      expect(screen.getByText('Maria Green')).toBeInTheDocument();
    });
    // Unread count badge should be visible (count = 1)
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('restores unread state when optimistic mark-read fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [mockMessage] });
    vi.mocked(api.post).mockResolvedValue({ success: false, error: 'Nope' });

    render(<FederationMessagesPage />);

    await waitFor(() => {
      expect(screen.getByText('Maria Green')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Maria Green'));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v2/federation/messages/mark-read-batch', { ids: [1] });
    });
    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument();
    });
  });
});
