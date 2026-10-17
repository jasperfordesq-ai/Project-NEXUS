// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Batch render tests for Content admin modules:
 * - AttributesAdmin, MenuBuilder, MenusAdmin, PageBuilder,
 *   PagesAdmin, PlanForm, PlansAdmin, Subscriptions
 *
 * Smoke tests only — verify each component renders without crashing.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ConfirmDialogProvider } from '@/components/ui';

// ─── Common mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [] }),
    post: vi.fn().mockResolvedValue({ success: true }),
    put: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn(), getAccessToken: vi.fn() },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Admin', last_name: 'User', name: 'Admin User', role: 'admin', is_super_admin: true, tenant_id: 2 },
    isAuthenticated: true,
    logout: vi.fn(),
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Community', slug: 'test', configuration: {} },
    tenantSlug: 'test',
    branding: { name: 'Test Community' },
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    tenantPath: (p: string) => `/test${p}`,
  })),
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), showToast: vi.fn() })),
  useNotifications: vi.fn(() => ({ counts: { messages: 0, notifications: 0 } })),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url: string) => url || '/default.png'),
  formatRelativeTime: vi.fn(() => '2 hours ago'),
  resolveAssetUrl: vi.fn((url: string) => url || ''),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('@/components/seo', () => ({
  PageMeta: () => null,
}));

// Mock admin API modules used by content components
vi.mock('../../api/adminApi', () => ({
  adminCategories: {
    list: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getAttributes: vi.fn().mockResolvedValue({ success: true, data: [] }),
    createAttribute: vi.fn().mockResolvedValue({ success: true }),
    updateAttribute: vi.fn().mockResolvedValue({ success: true }),
    deleteAttribute: vi.fn().mockResolvedValue({ success: true }),
  },
  adminMenus: {
    list: vi.fn().mockResolvedValue({ success: true, data: [] }),
    get: vi.fn().mockResolvedValue({ success: true, data: { id: 1, name: 'Main', items: [] } }),
    getItems: vi.fn().mockResolvedValue({ success: true, data: [] }),
    create: vi.fn().mockResolvedValue({ success: true }),
    update: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
    createItem: vi.fn().mockResolvedValue({ success: true }),
    updateItem: vi.fn().mockResolvedValue({ success: true }),
    deleteItem: vi.fn().mockResolvedValue({ success: true }),
  },
  adminPages: {
    list: vi.fn().mockResolvedValue({ success: true, data: [] }),
    get: vi.fn().mockResolvedValue({ success: true, data: { id: 1, title: 'Test', slug: 'test', content: '', meta_description: '', status: 'draft' } }),
    create: vi.fn().mockResolvedValue({ success: true }),
    update: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
  adminPlans: {
    list: vi.fn().mockResolvedValue({ success: true, data: [] }),
    get: vi.fn().mockResolvedValue({ success: true, data: { id: 1, name: 'Basic', description: '', price_monthly: '0', price_yearly: '0', tier_level: '1', max_menus: '5', max_menu_items: '20', features: '', is_active: true } }),
    create: vi.fn().mockResolvedValue({ success: true }),
    update: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
    getSubscriptions: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
}));

// ─── Wrapper helpers ─────────────────────────────────────────────────────────

function W({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemoryRouter initialEntries={['/test/admin']}>
        {children}
      </MemoryRouter>
    </>
  );
}

function WRoute({ children, path, entry }: { children: React.ReactNode; path: string; entry: string }) {
  return (
    <>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path={path} element={children} />
        </Routes>
      </MemoryRouter>
    </>
  );
}

// ─── AttributesAdmin ────────────────────────────────────────────────────────

import { AttributesAdmin } from '../content/AttributesAdmin';

describe('AttributesAdmin', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><AttributesAdmin /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── MenuBuilder ────────────────────────────────────────────────────────────

import { MenuBuilder } from '../content/MenuBuilder';

describe('MenuBuilder', () => {
  it('renders without crashing with route param', () => {
    const { container } = render(
      <WRoute path="/admin/menus/:id" entry="/admin/menus/1">
        <MenuBuilder />
      </WRoute>
    );
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── MenusAdmin ─────────────────────────────────────────────────────────────

import { MenusAdmin } from '../content/MenusAdmin';

describe('MenusAdmin', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><MenusAdmin /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── PageBuilder ────────────────────────────────────────────────────────────

import { PageBuilder } from '../content/PageBuilder';

describe('PageBuilder', () => {
  it('renders without crashing with route param', () => {
    const { container } = render(
      <ConfirmDialogProvider>
        <WRoute path="/admin/pages/:id" entry="/admin/pages/1">
          <PageBuilder />
        </WRoute>
      </ConfirmDialogProvider>
    );
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── PagesAdmin ─────────────────────────────────────────────────────────────

import { PagesAdmin } from '../content/PagesAdmin';

describe('PagesAdmin', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><PagesAdmin /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── PlanForm ───────────────────────────────────────────────────────────────

import { PlanForm } from '../content/PlanForm';

describe('PlanForm', () => {
  it('renders without crashing with route param', () => {
    const { container } = render(
      <WRoute path="/admin/plans/:id" entry="/admin/plans/1">
        <PlanForm />
      </WRoute>
    );
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── PlansAdmin ─────────────────────────────────────────────────────────────

import { PlansAdmin } from '../content/PlansAdmin';

describe('PlansAdmin', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><PlansAdmin /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── Subscriptions ──────────────────────────────────────────────────────────

import { Subscriptions } from '../content/Subscriptions';

describe('Subscriptions', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><Subscriptions /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});
