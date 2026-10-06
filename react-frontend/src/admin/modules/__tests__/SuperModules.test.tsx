// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Batch render tests for Super admin modules:
 * - BulkOperations, FederationAuditLog, FederationControls,
 *   FederationTenantFeatures, SuperDashboard, SuperUserForm,
 *   SuperUserList, TenantForm, TenantHierarchy, TenantList,
 *   TenantShow, UserShow
 *
 * Smoke tests only — verify each component renders without crashing.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

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

// TenantForm imports PlaceAutocompleteInput directly (bundle budget), and that component reads
// useTenant from the direct module, so the barrel mock above would not reach it.
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Community', slug: 'test', configuration: {} },
    tenantSlug: 'test',
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    tenantPath: (p: string) => `/test${p}`,
  })),
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

vi.mock('@/lib/motion', () => ({
  motion: new Proxy({}, {
    get: (_target: unknown, tag: string | symbol) => {
      const Component = ({ children, variants, initial, animate, exit, layout, whileHover, whileTap, transition, ...rest }: Record<string, unknown>) => {
        void variants; void initial; void animate; void exit; void layout; void whileHover; void whileTap; void transition;
        const Tag = typeof tag === 'string' ? tag : 'div';
        return <Tag {...rest}>{children}</Tag>;
      };
      return Component;
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null, XAxis: () => null, YAxis: () => null,
  CartesianGrid: () => null, Tooltip: () => null, Legend: () => null,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: () => null, Cell: () => null,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => null,
}));

// Mock admin API modules used by super components
vi.mock('../../api/adminApi', () => ({
  adminSuper: {
    getDashboard: vi.fn().mockResolvedValue({
      success: true,
      data: {
        tenants: 5, users: 100, active_users: 50, total_transactions: 200,
        total_hours: 500, recent_tenants: [], system_health: {},
      },
    }),
    listTenants: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getTenant: vi.fn().mockResolvedValue({
      success: true,
      data: {
        id: 1, name: 'Test Tenant', slug: 'test', domain: 'test.example.com',
        status: 'active', is_hub: false, parent_id: null,
        configuration: {}, features: {}, modules: {},
        created_at: '2026-01-01', user_count: 10,
      },
    }),
    createTenant: vi.fn().mockResolvedValue({ success: true }),
    updateTenant: vi.fn().mockResolvedValue({ success: true }),
    deleteTenant: vi.fn().mockResolvedValue({ success: true }),
    getHierarchy: vi.fn().mockResolvedValue({ success: true, data: [] }),
    updateHierarchy: vi.fn().mockResolvedValue({ success: true }),
    listUsers: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getUser: vi.fn().mockResolvedValue({
      success: true,
      data: {
        id: 1, first_name: 'Test', last_name: 'User', email: 'test@example.com',
        role: 'member', status: 'active', tenant_id: 2, tenant_name: 'Test',
        created_at: '2026-01-01',
      },
    }),
    createUser: vi.fn().mockResolvedValue({ success: true }),
    updateUser: vi.fn().mockResolvedValue({ success: true }),
    deleteUser: vi.fn().mockResolvedValue({ success: true }),
    bulkMoveUsers: vi.fn().mockResolvedValue({ success: true }),
    bulkUpdateTenants: vi.fn().mockResolvedValue({ success: true }),
    grantSuperAdmin: vi.fn().mockResolvedValue({ success: true }),
    revokeSuperAdmin: vi.fn().mockResolvedValue({ success: true }),
    grantGlobalSuperAdmin: vi.fn().mockResolvedValue({ success: true }),
    revokeGlobalSuperAdmin: vi.fn().mockResolvedValue({ success: true }),
    moveUserTenant: vi.fn().mockResolvedValue({ success: true }),
    moveAndPromote: vi.fn().mockResolvedValue({ success: true }),
    // GET /v2/admin/super/audit sends a bare array (respondWithData), which the
    // shared api client (src/lib/api.ts) resolves as `data: [rows]`, not nested.
    getAudit: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getSystemControls: vi.fn().mockResolvedValue({ success: true, data: {} }),
    updateSystemControls: vi.fn().mockResolvedValue({ success: true }),
    getWhitelist: vi.fn().mockResolvedValue({ success: true, data: [] }),
    addToWhitelist: vi.fn().mockResolvedValue({ success: true }),
    removeFromWhitelist: vi.fn().mockResolvedValue({ success: true }),
    getFederationPartnerships: vi.fn().mockResolvedValue({ success: true, data: [] }),
    suspendPartnership: vi.fn().mockResolvedValue({ success: true }),
    terminatePartnership: vi.fn().mockResolvedValue({ success: true }),
    emergencyLockdown: vi.fn().mockResolvedValue({ success: true }),
    liftLockdown: vi.fn().mockResolvedValue({ success: true }),
    getTenantFederationFeatures: vi.fn().mockResolvedValue({ success: true, data: {} }),
    updateTenantFederationFeature: vi.fn().mockResolvedValue({ success: true }),
    getAuditLog: vi.fn().mockResolvedValue({ success: true, data: { data: [], meta: { page: 1, total_pages: 1, per_page: 25, total: 0 } } }),
    exportAuditLog: vi.fn().mockResolvedValue({ success: true }),
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

// ─── BulkOperations ─────────────────────────────────────────────────────────

import { BulkOperations } from '../super/BulkOperations';

describe('BulkOperations', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><BulkOperations /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── FederationAuditLog ─────────────────────────────────────────────────────

import { FederationAuditLog } from '../super/FederationAuditLog';

describe('FederationAuditLog (super)', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><FederationAuditLog /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── FederationControls ─────────────────────────────────────────────────────

import { FederationControls } from '../super/FederationControls';

describe('FederationControls (super)', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><FederationControls /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── FederationTenantFeatures ───────────────────────────────────────────────

import { FederationTenantFeatures } from '../super/FederationTenantFeatures';

describe('FederationTenantFeatures (super)', () => {
  it('renders without crashing with route param', () => {
    const { container } = render(
      <WRoute path="/super-admin/federation/tenants/:tenantId" entry="/super-admin/federation/tenants/1">
        <FederationTenantFeatures />
      </WRoute>
    );
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── SuperDashboard ─────────────────────────────────────────────────────────

import { SuperDashboard } from '../super/SuperDashboard';

describe('SuperDashboard', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><SuperDashboard /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── SuperUserForm ──────────────────────────────────────────────────────────

import { SuperUserForm } from '../super/SuperUserForm';

describe('SuperUserForm', () => {
  it('renders without crashing with route param', () => {
    const { container } = render(
      <WRoute path="/super-admin/users/:id" entry="/super-admin/users/1">
        <SuperUserForm />
      </WRoute>
    );
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── SuperUserList ──────────────────────────────────────────────────────────

import { SuperUserList } from '../super/SuperUserList';

describe('SuperUserList', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><SuperUserList /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── TenantForm ─────────────────────────────────────────────────────────────

import { TenantForm } from '../super/TenantForm';

describe('TenantForm (super)', () => {
  it('renders without crashing with route param', () => {
    const { container } = render(
      <WRoute path="/super-admin/tenants/:id" entry="/super-admin/tenants/1">
        <TenantForm />
      </WRoute>
    );
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── TenantHierarchy ────────────────────────────────────────────────────────

import { TenantHierarchy } from '../super/TenantHierarchy';

describe('TenantHierarchy (super)', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><TenantHierarchy /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── TenantList ─────────────────────────────────────────────────────────────

import { TenantList } from '../super/TenantList';

describe('TenantList (super)', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><TenantList /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── TenantShow ─────────────────────────────────────────────────────────────

import { TenantShow } from '../super/TenantShow';

describe('TenantShow (super)', () => {
  it('renders without crashing with route param', () => {
    const { container } = render(
      <WRoute path="/super-admin/tenants/:id" entry="/super-admin/tenants/1">
        <TenantShow />
      </WRoute>
    );
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── UserShow ───────────────────────────────────────────────────────────────

import { UserShow } from '../super/UserShow';

describe('UserShow (super)', () => {
  it('renders without crashing with route param', () => {
    const { container } = render(
      <WRoute path="/super-admin/users/:id" entry="/super-admin/users/1">
        <UserShow />
      </WRoute>
    );
    expect(container.querySelector('div')).toBeTruthy();
  });
});
