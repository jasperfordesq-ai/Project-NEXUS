// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * PollsPage — Translate (owner, 31 Oct 2026: the poll itself, not only its
 * comments, must be translatable). One press translates the question, the
 * description and every option label; "Show original" restores them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import React from 'react';

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    put: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
    download: vi.fn().mockResolvedValue(new Blob()),
  },
  API_BASE: 'http://localhost:8090/api',
  tokenManager: { getTenantId: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  resolveAvatarUrl: (url: string | null | undefined) => url || '/default-avatar.png',
  formatRelativeTime: (d: string | null | undefined) => d ?? '',
}));

const stableToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const stableTenant = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
  branding: { name: 'Test Community' },
  tenantPath: (p: string) => `/test${p}`,
  hasFeature: vi.fn(() => true),
  hasModule: vi.fn(() => true),
  isLoading: false,
};

vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => stableTenant),
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test', role: 'member' },
    isAuthenticated: true,
    login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null,
  })),
  useToast: vi.fn(() => stableToast),
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

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo', () => ({ PageMeta: () => null }));
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
    </div>
  ),
}));
vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('@/lib/motion', () => {
  const motionProps = new Set(['variants', 'initial', 'animate', 'layout', 'transition', 'exit', 'whileHover', 'whileTap', 'whileInView', 'viewport']);
  const filterMotion = (props: Record<string, unknown>) => {
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) { if (!motionProps.has(k)) filtered[k] = v; }
    return filtered;
  };
  return {
    motion: {
      div: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) => <div {...filterMotion(props)}>{children}</div>,
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

import { PollsPage } from './PollsPage';

const poll = {
  id: 40,
  question: '¿Vienes el viernes?',
  description: 'Sesión abierta en la biblioteca.',
  expires_at: null,
  created_at: '2026-10-03T17:20:04Z',
  total_votes: 0,
  status: 'open',
  has_voted: false,
  voted_option_id: null,
  options: [
    { id: 140, label: 'Sí', vote_count: null, percentage: null },
    { id: 141, label: 'No puedo', vote_count: null, percentage: null },
  ],
  creator: { id: 218, name: 'Poll Author', avatar_url: null },
};

const translations: Record<string, string> = {
  poll: 'Are you coming on Friday?',
  poll_description: 'Open session at the library.',
  poll_option_140: 'Yes',
  poll_option_141: "I can't",
};

describe('PollsPage — Translate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((url: string) => Promise.resolve(
      url.startsWith('/v2/polls?') ? { success: true, data: [poll] } : { success: true, data: [] },
    ));
    mockApiPost.mockImplementation((url: string, body: { content_type: string }) => Promise.resolve(
      url === '/v2/ugc-translate'
        ? { success: true, data: { translated_text: translations[body.content_type], source_locale: 'es', target_locale: 'en', cached: false } }
        : { success: true },
    ));
  });

  it('translates the question, description and options together, then restores them', async () => {
    render(<PollsPage />);
    await screen.findByText('¿Vienes el viernes?');

    fireEvent.click(screen.getByRole('button', { name: /^translate$/i }));

    await screen.findByText('Are you coming on Friday?');
    expect(screen.getByText('Open session at the library.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Yes/ })).toBeInTheDocument();
    expect(screen.getByText("I can't")).toBeInTheDocument();
    expect(mockApiPost).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'poll', content_id: 40, source_text: '¿Vienes el viernes?',
    }));
    expect(mockApiPost).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'poll_description', content_id: 40, source_text: 'Sesión abierta en la biblioteca.',
    }));
    expect(mockApiPost).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'poll_option_140', content_id: 40, source_text: 'Sí',
    }));
    expect(mockApiPost).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'poll_option_141', content_id: 40, source_text: 'No puedo',
    }));

    fireEvent.click(screen.getByRole('button', { name: /show original/i }));
    await screen.findByText('¿Vienes el viernes?');
    expect(screen.getByText('Sesión abierta en la biblioteca.')).toBeInTheDocument();
    expect(screen.getByText('No puedo')).toBeInTheDocument();
    expect(screen.queryByText('Are you coming on Friday?')).not.toBeInTheDocument();
  });
});
