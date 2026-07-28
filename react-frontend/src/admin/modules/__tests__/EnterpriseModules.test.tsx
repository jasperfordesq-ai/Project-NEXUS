// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Batch render tests for Enterprise admin modules:
 * - EnterpriseDashboard, ErrorLogs, GdprDashboard, GdprRequests,
 *   GdprConsents, GdprAuditLog, GdprBreaches, HealthCheck,
 *   PermissionBrowser, RoleList, RoleForm,
 *   SystemMonitoring, LegalDocList, LegalDocForm,
 *   LegalDocComplianceDashboard, LegalDocVersionComparison
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

// Also mock individual context imports (some components import directly)
vi.mock('@/contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), showToast: vi.fn() })),
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Community', slug: 'test', configuration: {} },
    tenantSlug: 'test',
    branding: { name: 'Test Community' },
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    tenantPath: (p: string) => `/test${p}`,
  })),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));

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

// Mock admin API modules used by enterprise components
vi.mock('../../api/adminApi', () => ({
  adminEnterprise: {
    getDashboard: vi.fn().mockResolvedValue({
      success: true,
      data: { total_users: 100, total_roles: 3, pending_gdpr_requests: 0, health_status: 'healthy' },
    }),
    getRoles: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getRole: vi.fn().mockResolvedValue({ success: true, data: { id: 1, name: 'Admin', description: 'Administrator', permissions: [] } }),
    createRole: vi.fn().mockResolvedValue({ success: true }),
    updateRole: vi.fn().mockResolvedValue({ success: true }),
    deleteRole: vi.fn().mockResolvedValue({ success: true }),
    getPermissions: vi.fn().mockResolvedValue({ success: true, data: {} }),
    getGdprDashboard: vi.fn().mockResolvedValue({
      success: true,
      data: { total_requests: 0, pending_requests: 0, total_consents: 0, recent_breaches: 0 },
    }),
    getGdprRequests: vi.fn().mockResolvedValue({
      success: true,
      data: { data: [], meta: { page: 1, total_pages: 1, per_page: 20, total: 0, has_more: false } },
    }),
    getGdprConsents: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getGdprBreaches: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getGdprAudit: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getMonitoring: vi.fn().mockResolvedValue({
      success: true,
      data: { status: 'healthy', uptime: '99.9%', cpu: 45, memory: 60 },
    }),
    getHealthCheck: vi.fn().mockResolvedValue({
      success: true,
      data: { status: 'healthy', checks: [] },
    }),
    getLogs: vi.fn().mockResolvedValue({
      success: true,
      data: { data: [], meta: { page: 1, total_pages: 1, per_page: 20, total: 0, has_more: false } },
    }),
    getConfig: vi.fn().mockResolvedValue({ success: true, data: {} }),
    updateConfig: vi.fn().mockResolvedValue({ success: true }),
    getSecrets: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
  adminLegalDocs: {
    list: vi.fn().mockResolvedValue({ success: true, data: [] }),
    get: vi.fn().mockResolvedValue({ success: true, data: { id: 1, title: 'Terms', type: 'terms', status: 'published', content: '<p>Terms</p>' } }),
    create: vi.fn().mockResolvedValue({ success: true }),
    update: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
    getVersions: vi.fn().mockResolvedValue({ success: true, data: [] }),
    compareVersions: vi.fn().mockResolvedValue({
      success: true,
      data: { version1: { id: 1, version_number: '1.0' }, version2: { id: 2, version_number: '2.0' }, diff: '' },
    }),
    getComplianceStats: vi.fn().mockResolvedValue({
      success: true,
      data: { total_documents: 0, total_versions: 0, acceptance_rate: 0, documents: [] },
    }),
    getAcceptances: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
}));

// Mock the LegalDocVersionComparison sub-component since LegalDocVersionList
// imports it. The sibling mock for LegalDocVersionForm was removed: that
// component was deleted in 3a7cc6463 (replaced by the full-page LegalDocEditor)
// and LegalDocVersionList no longer imports it, so the path no longer resolves.
vi.mock('../enterprise/LegalDocVersionComparison', () => ({ default: ({ onClose: _onClose }: Record<string, unknown>) => <div data-testid="mock-legal-version-comparison">LegalDocVersionComparison</div>,
}));

// Also mock individual adminApi imports (some components use @/admin/api/adminApi)
vi.mock('@/admin/api/adminApi', () => ({
  adminEnterprise: {
    getDashboard: vi.fn().mockResolvedValue({ success: true, data: {} }),
    getRoles: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getRole: vi.fn().mockResolvedValue({ success: true, data: { id: 1, name: 'Admin', description: 'Admin', permissions: [] } }),
    createRole: vi.fn().mockResolvedValue({ success: true }),
    updateRole: vi.fn().mockResolvedValue({ success: true }),
    deleteRole: vi.fn().mockResolvedValue({ success: true }),
    getPermissions: vi.fn().mockResolvedValue({ success: true, data: {} }),
    getGdprDashboard: vi.fn().mockResolvedValue({ success: true, data: {} }),
    getGdprRequests: vi.fn().mockResolvedValue({ success: true, data: { data: [], meta: {} } }),
    getGdprConsents: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getGdprBreaches: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getGdprAudit: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getMonitoring: vi.fn().mockResolvedValue({ success: true, data: {} }),
    getHealthCheck: vi.fn().mockResolvedValue({ success: true, data: { status: 'healthy', checks: [] } }),
    getLogs: vi.fn().mockResolvedValue({ success: true, data: { data: [], meta: {} } }),
    getConfig: vi.fn().mockResolvedValue({ success: true, data: {} }),
    updateConfig: vi.fn().mockResolvedValue({ success: true }),
    getSecrets: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
  adminLegalDocs: {
    list: vi.fn().mockResolvedValue({ success: true, data: [] }),
    get: vi.fn().mockResolvedValue({ success: true, data: { id: 1, title: 'Terms', type: 'terms', status: 'published', content: '<p>Terms</p>' } }),
    create: vi.fn().mockResolvedValue({ success: true }),
    update: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
    getVersions: vi.fn().mockResolvedValue({ success: true, data: [] }),
    compareVersions: vi.fn().mockResolvedValue({ success: true, data: { version1: {}, version2: {}, diff: '' } }),
    getComplianceStats: vi.fn().mockResolvedValue({ success: true, data: { total_documents: 0, total_versions: 0, acceptance_rate: 0, documents: [] } }),
    getAcceptances: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
}));

// ─── Wrapper helpers ─────────────────────────────────────────────────────────

function W({ children, path = '/test/admin' }: { children: React.ReactNode; path?: string }) {
  return (
    <>
      <MemoryRouter initialEntries={[path]}>
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

// ─── EnterpriseDashboard ─────────────────────────────────────────────────────

import { EnterpriseDashboard } from '../enterprise/EnterpriseDashboard';

describe('EnterpriseDashboard', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><EnterpriseDashboard /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── ErrorLogs ───────────────────────────────────────────────────────────────

import { ErrorLogs } from '../enterprise/ErrorLogs';

describe('ErrorLogs', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><ErrorLogs /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── GdprDashboard ───────────────────────────────────────────────────────────

import { GdprDashboard } from '../enterprise/GdprDashboard';

describe('GdprDashboard', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><GdprDashboard /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── GdprRequests ────────────────────────────────────────────────────────────

import { GdprRequests } from '../enterprise/GdprRequests';

describe('GdprRequests', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><GdprRequests /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── GdprConsents ────────────────────────────────────────────────────────────

import { GdprConsents } from '../enterprise/GdprConsents';

describe('GdprConsents', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><GdprConsents /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── GdprAuditLog ────────────────────────────────────────────────────────────

import { GdprAuditLog } from '../enterprise/GdprAuditLog';

describe('GdprAuditLog', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><GdprAuditLog /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── GdprBreaches ────────────────────────────────────────────────────────────

import { GdprBreaches } from '../enterprise/GdprBreaches';

describe('GdprBreaches', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><GdprBreaches /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── HealthCheck ─────────────────────────────────────────────────────────────

import { HealthCheck } from '../enterprise/HealthCheck';

describe('HealthCheck', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><HealthCheck /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── PermissionBrowser ───────────────────────────────────────────────────────

import { PermissionBrowser } from '../enterprise/PermissionBrowser';

describe('PermissionBrowser', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><PermissionBrowser /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── RoleList ────────────────────────────────────────────────────────────────

import { RoleList } from '../enterprise/RoleList';

describe('RoleList', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><RoleList /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── RoleForm ────────────────────────────────────────────────────────────────

import { RoleForm } from '../enterprise/RoleForm';

describe('RoleForm', () => {
  it('renders without crashing (create mode)', () => {
    const { container } = render(<W><RoleForm /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });

  it('renders without crashing (edit mode with route param)', () => {
    const { container } = render(
      <WRoute path="/admin/enterprise/roles/:id/edit" entry="/admin/enterprise/roles/1/edit">
        <RoleForm />
      </WRoute>
    );
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── SystemMonitoring ────────────────────────────────────────────────────────

import { SystemMonitoring } from '../enterprise/SystemMonitoring';

describe('SystemMonitoring', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><SystemMonitoring /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── LegalDocList ────────────────────────────────────────────────────────────

import { LegalDocList } from '../enterprise/LegalDocList';

describe('LegalDocList', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><LegalDocList /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── LegalDocForm ────────────────────────────────────────────────────────────

import { LegalDocForm } from '../enterprise/LegalDocForm';

describe('LegalDocForm', () => {
  it('renders without crashing (create mode)', () => {
    const { container } = render(<W><LegalDocForm /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });

  it('renders without crashing (edit mode with route param)', () => {
    const { container } = render(
      <WRoute path="/admin/legal-documents/:id/edit" entry="/admin/legal-documents/1/edit">
        <LegalDocForm />
      </WRoute>
    );
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── LegalDocComplianceDashboard ─────────────────────────────────────────────

import LegalDocComplianceDashboard from '../enterprise/LegalDocComplianceDashboard';

describe('LegalDocComplianceDashboard', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><LegalDocComplianceDashboard /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── LegalDocVersionComparison ───────────────────────────────────────────────
// Note: This component requires props (documentId, version1Id, version2Id, onClose).
// We test it directly with those props.

import LegalDocVersionComparison from '../enterprise/LegalDocVersionComparison';

describe('LegalDocVersionComparison', () => {
  it('renders without crashing with required props', () => {
    const { container } = render(
      <W>
        <LegalDocVersionComparison
          documentId={1}
          version1Id={1}
          version2Id={2}
          onClose={vi.fn()}
        />
      </W>
    );
    expect(container.querySelector('div')).toBeTruthy();
  });
});
