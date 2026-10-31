// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Owner, 31 Oct 2026: an organisation's own name and description must be
 * translatable. One Translate press translates both. Mocks copied from
 * OrganisationDetailPage.test.tsx.
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
  useTranslation: () => ({
    // The shared Translate button reads the reader's language.
    i18n: { language: 'en' },
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.fallbackValue) return opts.fallbackValue as string;
      if (opts?.ns) return `${String(opts.ns)}:${key}`;
      return key;
    },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('react-router-dom', async () => {
  const actual = await import('react-router-dom');
  const React = await import('react');
  return {
    ...actual,
    Link: ({ children, to, ...rest }: { children: ReactNode; to: string; [k: string]: unknown }) =>
      React.createElement('a', { href: String(to), ...rest }, children),
    useNavigate: () => vi.fn(),
    useParams: () => ({ id: '7' }),
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

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/helpers', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/helpers')>();

  return {
    ...original,
    resolveAvatarUrl: (url: string | null) => url ?? '',
    cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  };
});

// PageMeta is imported via the deep path `@/components/seo/PageMeta`, which the
// global `@/components/seo` mock in src/test/setup.ts does NOT intercept. Left
// real, it calls useTenant() from @/contexts/TenantContext (bypassing this file's
// `@/contexts` mock) and throws "useTenant must be used within a TenantProvider".
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// Breadcrumbs also pulls useTenant() from @/contexts/TenantContext (deep path,
// not this file's `@/contexts` barrel mock), so stub it out like the sibling
// OrganisationsPage test does.
vi.mock('@/components/navigation', () => ({
  Breadcrumbs: ({ items }: { items: { label: string; href?: string }[] }) => (
    <nav data-testid="breadcrumbs">
      {items.map((item) => (
        <span key={item.label}>{item.label}</span>
      ))}
    </nav>
  ),
}));

import { OrganisationDetailPage } from './OrganisationDetailPage';

const organisation = {
  id: 7,
  name: 'Fondo Comunitario Verde',
  description: 'Ayudamos a las comunidades locales.',
  logo_url: null,
  website: null,
  contact_email: null,
  location: null,
  opportunity_count: 0,
  total_hours: 0,
  volunteer_count: 0,
  average_rating: null,
  review_count: 0,
  created_at: '2025-01-01T00:00:00Z',
};

const translations: Record<string, string> = {
  organisation: 'We help local communities.',
  organisation_name: 'Green Community Fund',
};

describe('OrganisationDetailPage — Translate the name and description', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/reviews/organization/')) return Promise.resolve({ success: true, data: { reviews: [] } });
      if (url.includes('/opportunities')) return Promise.resolve({ success: true, data: [] });
      if (url.includes('/organisations/')) return Promise.resolve({ success: true, data: organisation });
      return Promise.resolve({ success: true, data: null });
    });
    vi.mocked(api.post).mockImplementation((_url: string, body?: unknown) => Promise.resolve({
      success: true,
      data: {
        translated_text: translations[(body as { content_type: string }).content_type],
        source_locale: 'es', target_locale: 'en', cached: false,
      },
    }));
  });

  it('translates name and description together and restores the originals', async () => {
    render(<OrganisationDetailPage />);
    expect(await screen.findByText('Ayudamos a las comunidades locales.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'translate.translate' }));

    expect(await screen.findByText('We help local communities.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Green Community Fund');
    expect(api.post).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'organisation', content_id: 7, source_text: 'Ayudamos a las comunidades locales.',
    }));
    expect(api.post).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'organisation_name', content_id: 7, source_text: 'Fondo Comunitario Verde',
    }));

    fireEvent.click(screen.getByRole('button', { name: 'translate.show_original' }));
    expect(await screen.findByText('Ayudamos a las comunidades locales.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Fondo Comunitario Verde');
  });
});
