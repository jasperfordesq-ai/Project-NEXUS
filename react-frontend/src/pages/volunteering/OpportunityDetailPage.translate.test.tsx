// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Owner, 31 Oct 2026: a volunteering opportunity's own title and description
 * must be translatable. One Translate press translates both. Mocks copied from
 * OpportunityDetailPage.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { api } from '@/lib/api';
import type { ReactNode } from 'react';

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: { children?: ReactNode; [k: string]: unknown }) => {
      const { variants: _v, initial: _i, animate: _a, exit: _e, transition: _t, ...rest } = props as Record<string, unknown>;
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.fallbackValue) return opts.fallbackValue as string;
      if (key === 'opportunity.application_status') return `Status: ${String(opts?.status ?? '')}`;
      return key;
    },
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await import('react-router-dom');
  const React = await import('react');
  return {
    ...actual,
    Link: ({ children, to, ...rest }: { children: ReactNode; to: string; [k: string]: unknown }) =>
      React.createElement('a', { href: String(to), ...rest }, children),
    useNavigate: () => vi.fn(),
    useParams: () => ({ id: '42' }),
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
    user: { id: 5, first_name: 'Jane', name: 'Jane Owner', role: 'member' },
    isAuthenticated: true,
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useToast: vi.fn(() => mockToast),

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
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/helpers')>()),
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  resolveAvatarUrl: (url: string | null) => url ?? '',
}));
// PageMeta, Breadcrumbs, and SocialInteractionPanel pull contexts straight from
// their direct module paths (bypassing the '@/contexts' barrel mock), so stub
// them out — otherwise every full-content render throws "useTenant must be used
// within a TenantProvider".
vi.mock('@/components/seo', () => ({ PageMeta: () => null }));
vi.mock('@/components/navigation', () => ({ Breadcrumbs: () => null }));
vi.mock('@/components/social/SocialInteractionPanel', () => ({ SocialInteractionPanel: () => null }));

const { mockConfirm, mockToast } = vi.hoisted(() => ({
  mockConfirm: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/components/ui/ConfirmDialog', () => ({ useConfirm: () => mockConfirm }));

import OpportunityDetailPage from './OpportunityDetailPage';

const opportunity = {
  id: 42,
  title: 'Limpieza del parque',
  description: 'Ayuda a limpiar el parque local.',
  location: 'Parque',
  skills_needed: '',
  start_date: null,
  end_date: null,
  is_active: true,
  is_remote: false,
  category: null,
  organization: { id: 7, name: 'Verde', logo_url: null },
  created_at: '2026-01-10T12:00:00Z',
  shifts: [],
  has_applied: false,
  application: null,
  is_owner: false,
};

const translations: Record<string, string> = {
  vol_opportunity: 'Help clean the local park.',
  vol_opportunity_title: 'Park clean-up',
};

describe('OpportunityDetailPage — Translate the title and description', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ success: true, data: opportunity });
    vi.mocked(api.post).mockImplementation((_url: string, body?: unknown) => Promise.resolve({
      success: true,
      data: {
        translated_text: translations[(body as { content_type: string }).content_type],
        source_locale: 'es', target_locale: 'en', cached: false,
      },
    }));
  });

  it('translates title and description together and restores the originals', async () => {
    render(<OpportunityDetailPage />);
    expect(await screen.findByText('Ayuda a limpiar el parque local.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'translate.translate' }));

    expect(await screen.findByText('Help clean the local park.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Park clean-up');
    expect(api.post).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'vol_opportunity', content_id: 42, source_text: 'Ayuda a limpiar el parque local.',
    }));
    expect(api.post).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'vol_opportunity_title', content_id: 42, source_text: 'Limpieza del parque',
    }));

    fireEvent.click(screen.getByRole('button', { name: 'translate.show_original' }));
    expect(await screen.findByText('Ayuda a limpiar el parque local.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Limpieza del parque');
  });
});
