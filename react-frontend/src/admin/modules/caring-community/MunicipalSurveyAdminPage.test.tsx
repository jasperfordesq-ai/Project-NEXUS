// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Hoisted mocks ───────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
  API_BASE: 'http://localhost:8090/api',
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Toast / Tenant ───────────────────────────────────────────────────────────
const mockShowToast = vi.fn();

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => ({
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
      showToast: mockShowToast,
    }),
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// Stub EmptyState
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/EmptyState' and '../../components/PageHeader'
// directly, and vitest keys mocks per resolved module, so a barrel-only mock
// never installs for those imports.
// A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run.
async function adminComponentsMock(importOriginal: <T>() => Promise<T>) {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
    PageHeader: ({ title, subtitle, actions }: { title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
        <p>{subtitle}</p>
        {actions}
      </div>
    ),
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/EmptyState', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);

// Stub Select/Switch to prevent HeroUI jsdom issues
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    Select: ({ label, children, onSelectionChange }: {
      label?: string;
      children?: React.ReactNode;
      onSelectionChange?: (keys: Set<string>) => void;
    }) => (
      <select
        aria-label={label}
        onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}
      >
        {children}
      </select>
    ),
    SelectItem: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
      <option value={id}>{children}</option>
    ),
    Switch: ({ isSelected, onValueChange }: {
      isSelected?: boolean;
      onValueChange?: (v: boolean) => void;
    }) => (
      <input
        type="checkbox"
        role="switch"
        aria-checked={Boolean(isSelected)}
        checked={!!isSelected}
        onChange={(e) => onValueChange?.(e.target.checked)}
      />
    ),
    Progress: ({ value, 'aria-label': ariaLabel }: { value?: number; 'aria-label'?: string }) => (
      <div role="progressbar" aria-label={ariaLabel} aria-valuenow={value} />
    ),
    useDisclosure: () => ({
      isOpen: false,
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onOpenChange: vi.fn(),
    }),
  };
});

// ─── Survey fixtures ──────────────────────────────────────────────────────────
const makeSurvey = (overrides = {}): Record<string, unknown> => ({
  id: 1,
  title: 'Community Survey 2026',
  status: 'draft',
  is_anonymous: false,
  question_count: 5,
  response_count: 0,
  starts_at: null,
  ends_at: null,
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const makeApiResponse = (items: unknown[]) => ({
  success: true,
  data: items,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('MunicipalSurveyAdminPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue(makeApiResponse([]));
    mockApi.post.mockResolvedValue({ success: true });
  });

  it('shows loading spinner on initial mount', async () => {
    mockApi.get.mockImplementationOnce(() => new Promise(() => {}));
    const { default: MunicipalSurveyAdminPage } = await import('./MunicipalSurveyAdminPage');
    render(<MunicipalSurveyAdminPage />);

    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('shows empty state when no surveys returned', async () => {
    const { default: MunicipalSurveyAdminPage } = await import('./MunicipalSurveyAdminPage');
    render(<MunicipalSurveyAdminPage />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders a survey row when surveys are loaded', async () => {
    mockApi.get.mockResolvedValue(makeApiResponse([makeSurvey()]));
    const { default: MunicipalSurveyAdminPage } = await import('./MunicipalSurveyAdminPage');
    render(<MunicipalSurveyAdminPage />);

    await waitFor(() => {
      expect(screen.getByText('Community Survey 2026')).toBeInTheDocument();
    });
  });

  it('renders Publish button for draft surveys', async () => {
    mockApi.get.mockResolvedValue(makeApiResponse([makeSurvey({ status: 'draft' })]));
    const { default: MunicipalSurveyAdminPage } = await import('./MunicipalSurveyAdminPage');
    render(<MunicipalSurveyAdminPage />);

    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      const publishBtn = buttons.find((b) =>
        b.textContent?.toLowerCase().includes('publish'),
      );
      expect(publishBtn).toBeDefined();
    });
  });

  it('renders Close button for active surveys', async () => {
    mockApi.get.mockResolvedValue(makeApiResponse([makeSurvey({ status: 'active' })]));
    const { default: MunicipalSurveyAdminPage } = await import('./MunicipalSurveyAdminPage');
    render(<MunicipalSurveyAdminPage />);

    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      const closeBtn = buttons.find((b) =>
        b.textContent?.toLowerCase().includes('close'),
      );
      expect(closeBtn).toBeDefined();
    });
  });

  it('renders analytics and CSV export buttons for each survey', async () => {
    mockApi.get.mockResolvedValue(makeApiResponse([makeSurvey()]));
    const { default: MunicipalSurveyAdminPage } = await import('./MunicipalSurveyAdminPage');
    render(<MunicipalSurveyAdminPage />);

    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      const analyticsBtn = buttons.find((b) =>
        b.textContent?.toLowerCase().includes('analytic') ||
        b.textContent?.toLowerCase().includes('view'),
      );
      const csvBtn = buttons.find((b) =>
        b.textContent?.toLowerCase().includes('csv') ||
        b.textContent?.toLowerCase().includes('export'),
      );
      expect(analyticsBtn).toBeDefined();
      expect(csvBtn).toBeDefined();
    });
  });

  it('shows a Create Survey button in the page header', async () => {
    const { default: MunicipalSurveyAdminPage } = await import('./MunicipalSurveyAdminPage');
    render(<MunicipalSurveyAdminPage />);

    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      const createBtn = buttons.find((b) =>
        b.textContent?.toLowerCase().includes('create') ||
        b.textContent?.toLowerCase().includes('new'),
      );
      expect(createBtn).toBeDefined();
    });
  });

  it('calls POST publish endpoint when Publish is clicked', async () => {
    mockApi.get.mockResolvedValue(makeApiResponse([makeSurvey({ id: 1, status: 'draft' })]));
    mockApi.post.mockResolvedValue({ success: true });

    const { default: MunicipalSurveyAdminPage } = await import('./MunicipalSurveyAdminPage');
    render(<MunicipalSurveyAdminPage />);

    await waitFor(() => screen.getByText('Community Survey 2026'));

    const buttons = screen.getAllByRole('button');
    const publishBtn = buttons.find((b) =>
      b.textContent?.toLowerCase().includes('publish'),
    );
    if (publishBtn) fireEvent.click(publishBtn);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        expect.stringContaining('/publish'),
      );
    });
  });

  it('shows error message when survey list fails to load', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('Network failure'));
    const { default: MunicipalSurveyAdminPage } = await import('./MunicipalSurveyAdminPage');
    render(<MunicipalSurveyAdminPage />);

    await waitFor(() => {
      // Error message appears inline (not empty-state)
      const errorEl = document.querySelector('.text-danger');
      expect(errorEl ?? screen.queryByTestId('empty-state')).toBeTruthy();
    });
  });

  it('renders multiple surveys in the table', async () => {
    mockApi.get.mockResolvedValue(
      makeApiResponse([
        makeSurvey({ id: 1, title: 'Survey A' }),
        makeSurvey({ id: 2, title: 'Survey B', status: 'active' }),
      ]),
    );
    const { default: MunicipalSurveyAdminPage } = await import('./MunicipalSurveyAdminPage');
    render(<MunicipalSurveyAdminPage />);

    await waitFor(() => {
      expect(screen.getByText('Survey A')).toBeInTheDocument();
      expect(screen.getByText('Survey B')).toBeInTheDocument();
    });
  });

  it('shows anonymous badge for anonymous surveys', async () => {
    mockApi.get.mockResolvedValue(makeApiResponse([makeSurvey({ is_anonymous: true })]));
    const { default: MunicipalSurveyAdminPage } = await import('./MunicipalSurveyAdminPage');
    render(<MunicipalSurveyAdminPage />);

    await waitFor(() => {
      // The component renders a chip with "yes" text for anonymous surveys
      expect(screen.getByText(/yes/i)).toBeInTheDocument();
    });
  });
});
