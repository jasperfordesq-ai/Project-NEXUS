// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Batch render tests for System admin modules (extra, separate from SystemModules.test.tsx):
 * - ActivityLog, AdminSettings, BlogRestore, CronJobLogs, CronJobs,
 *   CronJobSettings, CronJobSetup, ImageSettings, NativeApp,
 *   SeedGenerator, TestRunner, WebpConverter
 *
 * Smoke tests only — verify each component renders without crashing.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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

// Mock admin API modules used by system components
vi.mock('../../api/adminApi', () => ({
  adminSystem: {
    getActivityLog: vi.fn().mockResolvedValue({
      success: true,
      data: { data: [], meta: { page: 1, total_pages: 1, per_page: 20, total: 0, has_more: false } },
    }),
    getCronJobs: vi.fn().mockResolvedValue({ success: true, data: [] }),
    runCronJob: vi.fn().mockResolvedValue({ success: true }),
  },
  adminCron: {
    getLogs: vi.fn().mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          job_id: 'geocode-batch',
          job_name: 'geocode-batch',
          status: 'success',
          output: 'Starting batch geocoding... Current Status: Users with coordinates: 229 Users needing geocoding: 0 Listings with coordinates: 40',
          duration_seconds: 0.15,
          executed_at: '2026-03-04T17:41:24Z',
          executed_by: 'manual-14',
        },
      ],
      meta: { page: 1, total_pages: 1, per_page: 20, total: 1 },
    }),
    clearLogs: vi.fn().mockResolvedValue({ success: true }),
    exportLogs: vi.fn().mockResolvedValue({ success: true }),
    getJobSettings: vi.fn().mockResolvedValue({ success: true, data: {} }),
    getGlobalSettings: vi.fn().mockResolvedValue({ success: true, data: {} }),
    updateJobSettings: vi.fn().mockResolvedValue({ success: true }),
    updateGlobalSettings: vi.fn().mockResolvedValue({ success: true }),
    getHealthMetrics: vi.fn().mockResolvedValue({ success: true, data: {} }),
  },
  adminSettings: {
    get: vi.fn().mockResolvedValue({ success: true, data: {} }),
    update: vi.fn().mockResolvedValue({ success: true }),
    getImageSettings: vi.fn().mockResolvedValue({ success: true, data: {} }),
    updateImageSettings: vi.fn().mockResolvedValue({ success: true }),
    getNativeAppSettings: vi.fn().mockResolvedValue({ success: true, data: {} }),
    updateNativeAppSettings: vi.fn().mockResolvedValue({ success: true }),
    getNativeAppInstallStats: vi.fn().mockResolvedValue({ success: true, data: null }),
  },
  adminTools: {
    getBlogBackups: vi.fn().mockResolvedValue({ success: true, data: [] }),
    restoreBlogBackup: vi.fn().mockResolvedValue({ success: true }),
    getWebpStats: vi.fn().mockResolvedValue({ success: true, data: { total: 0, converted: 0 } }),
    runWebpConversion: vi.fn().mockResolvedValue({ success: true }),
    runSeedGenerator: vi.fn().mockResolvedValue({ success: true }),
    runHealthCheck: vi.fn().mockResolvedValue({ success: true, data: { results: [] } }),
  },
}));

// ─── Wrapper ─────────────────────────────────────────────────────────────────

function W({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemoryRouter initialEntries={['/test/admin']}>
        {children}
      </MemoryRouter>
    </>
  );
}

// ─── ActivityLog ────────────────────────────────────────────────────────────

import { ActivityLog } from '../system/ActivityLog';

describe('ActivityLog', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><ActivityLog /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── AdminSettings ──────────────────────────────────────────────────────────

import { AdminSettings } from '../system/AdminSettings';

describe('AdminSettings', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><AdminSettings /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── BlogRestore ────────────────────────────────────────────────────────────

import { BlogRestore } from '../system/BlogRestore';

describe('BlogRestore', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><BlogRestore /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── CronJobLogs ────────────────────────────────────────────────────────────

import { CronJobLogs } from '../system/CronJobLogs';

describe('CronJobLogs', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><CronJobLogs /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });

  it('keeps log table columns from collapsing into vertical text', async () => {
    const { container } = render(<W><CronJobLogs /></W>);

    await waitFor(() => {
      expect(screen.getAllByText('geocode-batch').length).toBeGreaterThan(0);
    });

    const table = container.querySelector('table');
    const outputCell = screen.getByText(/Starting batch geocoding/).closest('td');
    const executedByCell = screen.getByText('manual-14').closest('td');

    expect(table?.className).toContain('min-w-[1180px]');
    expect(outputCell?.className).toContain('min-w-[34rem]');
    expect(executedByCell?.className).toContain('whitespace-nowrap');
  });
});

// ─── CronJobs ───────────────────────────────────────────────────────────────

import { CronJobs } from '../system/CronJobs';

describe('CronJobs', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><CronJobs /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── CronJobSettingsPage ────────────────────────────────────────────────────

import { CronJobSettingsPage } from '../system/CronJobSettings';

describe('CronJobSettingsPage', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><CronJobSettingsPage /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── CronJobSetup ───────────────────────────────────────────────────────────

import { CronJobSetup } from '../system/CronJobSetup';

describe('CronJobSetup', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><CronJobSetup /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── ImageSettings ──────────────────────────────────────────────────────────

import { ImageSettings } from '../system/ImageSettings';

describe('ImageSettings', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><ImageSettings /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── NativeApp ──────────────────────────────────────────────────────────────

import { NativeApp } from '../system/NativeApp';

describe('NativeApp', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><NativeApp /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── SeedGenerator ──────────────────────────────────────────────────────────

import { SeedGenerator } from '../system/SeedGenerator';

describe('SeedGenerator', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><SeedGenerator /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── TestRunner ─────────────────────────────────────────────────────────────

import { TestRunner } from '../system/TestRunner';

describe('TestRunner', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><TestRunner /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── WebpConverter ──────────────────────────────────────────────────────────

import { WebpConverter } from '../system/WebpConverter';

describe('WebpConverter', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><WebpConverter /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});
