// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── Hoisted mock data ────────────────────────────────────────────────────────
const { mockApi, mockToastError } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  mockToastError: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => ({
      success: vi.fn(),
      error: mockToastError,
      info: vi.fn(),
      warning: vi.fn(),
    }),
  }),
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// Stub HeroUI Tabs so tab panel content renders in JSDOM
// HeroUI v3 Tabs uses React Aria and doesn't render panel content in JSDOM without CSS
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    Tabs: ({ children, selectedKey, onSelectionChange, 'aria-label': ariaLabel }: {
      children?: React.ReactNode;
      selectedKey?: string;
      onSelectionChange?: (key: string) => void;
      'aria-label'?: string;
    }) => (
      <div role="tablist" aria-label={ariaLabel ?? undefined}>
        {React.Children.map(children, (child) => {
          if (!React.isValidElement(child)) return null;
          const tabKey = String((child as React.ReactElement<{ tabKey?: string; 'data-key'?: string; children?: React.ReactNode; title?: React.ReactNode }> & { key?: string | null }).key ?? '');
          const isSelected = tabKey === selectedKey;
          const tabEl = child as React.ReactElement<{ title?: React.ReactNode; children?: React.ReactNode }>;
          return (
            <div key={tabKey}>
              <button
                role="tab"
                aria-selected={isSelected}
                data-key={tabKey}
                onClick={() => onSelectionChange?.(tabKey)}
              >
                {tabEl.props.title}
              </button>
              {isSelected && <div role="tabpanel">{tabEl.props.children}</div>}
            </div>
          );
        })}
      </div>
    ),
    Tab: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Select: ({
      children,
      onSelectionChange,
      selectedKeys,
      label,
    }: {
      children?: React.ReactNode;
      onSelectionChange?: (keys: Set<string>) => void;
      selectedKeys?: Set<string>;
      label?: string;
    }) => (
      <select
        aria-label={label ?? undefined}
        value={selectedKeys ? Array.from(selectedKeys)[0] : ''}
        onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}
      >
        {children}
      </select>
    ),
    SelectItem: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
      <option value={id}>{children}</option>
    ),
  };
});

// Stub admin sub-components
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/PageHeader', '../../components/EmptyState', '../../components/DataTable'
// directly, and vitest keys mocks per resolved module, so a barrel-only mock
// never installs for those imports — the real components rendered and the
// stub data-testids were never in the DOM.
// A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run
// ("Cannot access 'adminComponentsMock' before initialization"). Declarations
// hoist with it.
function adminComponentsMock() {
  return {
    PageHeader: ({ title, description }: { title: string; description?: string }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
    ),
    EmptyState: ({ title }: { title: string }) => (
      <div data-testid="empty-state">{title}</div>
    ),
    DataTable: ({ data, columns }: { data: unknown[]; columns: Array<{ key: string; label: string; render?: (item: Record<string, unknown>) => React.ReactNode }> }) => (
      <table data-testid="data-table">
        <thead>
          <tr>
            {columns.map((col) => <th key={col.key}>{col.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {(data as Record<string, unknown>[]).map((row) => (
            <tr key={String(row['id'])}>
              {columns.map((col) => (
                <td key={col.key}>
                  {col.render ? col.render(row) : String(row[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    ),
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);
vi.mock('../../components/EmptyState', adminComponentsMock);
vi.mock('../../components/DataTable', adminComponentsMock);

// ── Fixtures ──────────────────────────────────────────────────────────────────
const makeInterview = (overrides = {}) => ({
  id: 1,
  vacancy_id: 10,
  application_id: 5,
  interview_type: 'video',
  scheduled_at: '2025-06-15T10:00:00Z',
  duration_mins: 45,
  location_notes: 'Zoom link provided',
  status: 'proposed',
  candidate_name: 'Alice Smith',
  candidate_email: 'alice@example.com',
  job_title: 'Software Engineer',
  created_at: '2025-06-01T00:00:00Z',
  ...overrides,
});

const makeOffer = (overrides = {}) => ({
  id: 2,
  vacancy_id: 10,
  application_id: 5,
  salary_offered: 45000,
  start_date: '2025-08-01',
  details: 'Full-time role',
  status: 'pending',
  expires_at: '2025-07-01T00:00:00Z',
  responded_at: null,
  candidate_name: 'Bob Jones',
  candidate_email: 'bob@example.com',
  job_title: 'Product Manager',
  created_at: '2025-06-10T00:00:00Z',
  ...overrides,
});

const makeApiResponse = (data: unknown[], meta = {}) => ({
  success: true,
  data,
  meta: { total: (data as unknown[]).length, ...meta },
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('JobPipelineOverview', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // interviews endpoint + offers endpoint both return empty by default
    mockApi.get.mockResolvedValue(makeApiResponse([]));
  });

  it('shows a loading spinner for interviews initially', async () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));
    const { JobPipelineOverview } = await import('./JobPipelineOverview');
    render(<JobPipelineOverview />);

    const busy = screen.getAllByRole('status').find(
      (el) => el.getAttribute('aria-busy') === 'true',
    );
    expect(busy).toBeInTheDocument();
  });

  it('renders empty state when no interviews are returned', async () => {
    const { JobPipelineOverview } = await import('./JobPipelineOverview');
    render(<JobPipelineOverview />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders DataTable when interviews are returned', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('interviews')) return Promise.resolve(makeApiResponse([makeInterview()]));
      return Promise.resolve(makeApiResponse([]));
    });

    const { JobPipelineOverview } = await import('./JobPipelineOverview');
    render(<JobPipelineOverview />);

    await waitFor(() => {
      expect(screen.getByTestId('data-table')).toBeInTheDocument();
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      expect(screen.getByText('Software Engineer')).toBeInTheDocument();
    });
  });

  it('shows candidate email in table row', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('interviews')) return Promise.resolve(makeApiResponse([makeInterview()]));
      return Promise.resolve(makeApiResponse([]));
    });

    const { JobPipelineOverview } = await import('./JobPipelineOverview');
    render(<JobPipelineOverview />);

    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    });
  });

  it('shows error toast when interviews API fails', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('interviews')) return Promise.resolve({ success: false, data: [] });
      return Promise.resolve(makeApiResponse([]));
    });

    const { JobPipelineOverview } = await import('./JobPipelineOverview');
    render(<JobPipelineOverview />);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
  });

  it('switches to Offers tab and shows offers data', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('offers')) return Promise.resolve(makeApiResponse([makeOffer()]));
      return Promise.resolve(makeApiResponse([]));
    });

    const { JobPipelineOverview } = await import('./JobPipelineOverview');
    render(<JobPipelineOverview />);

    // Click the Offers tab
    await waitFor(() => {
      const offersTab = screen.getAllByRole('tab').find((t) =>
        t.textContent?.toLowerCase().includes('offer'),
      );
      expect(offersTab).toBeDefined();
      fireEvent.click(offersTab!);
    });

    await waitFor(() => {
      expect(screen.getByText('Bob Jones')).toBeInTheDocument();
      expect(screen.getByText('Product Manager')).toBeInTheDocument();
    });
  });

  it('shows offers empty state when no offers are returned', async () => {
    // Both endpoints return empty
    const { JobPipelineOverview } = await import('./JobPipelineOverview');
    render(<JobPipelineOverview />);

    // Switch to offers tab
    await waitFor(() => {
      const offersTab = screen.getAllByRole('tab').find((t) =>
        t.textContent?.toLowerCase().includes('offer'),
      );
      expect(offersTab).toBeDefined();
      fireEvent.click(offersTab!);
    });

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('shows interview count chip when total > 0', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('interviews'))
        return Promise.resolve(makeApiResponse([makeInterview()], { total: 1 }));
      return Promise.resolve(makeApiResponse([]));
    });

    const { JobPipelineOverview } = await import('./JobPipelineOverview');
    render(<JobPipelineOverview />);

    await waitFor(() => {
      // The total count chip "1" should appear near the Interviews tab title
      const interviewsTab = screen.getAllByRole('tab').find((t) =>
        t.textContent?.includes('1'),
      );
      expect(interviewsTab).toBeDefined();
    });
  });

  it('shows error toast when offers API fails', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('offers')) return Promise.resolve({ success: false, data: [] });
      return Promise.resolve(makeApiResponse([]));
    });

    const { JobPipelineOverview } = await import('./JobPipelineOverview');
    render(<JobPipelineOverview />);

    // Switch to offers tab to trigger the render
    await waitFor(() => {
      const offersTab = screen.getAllByRole('tab').find((t) =>
        t.textContent?.toLowerCase().includes('offer'),
      );
      if (offersTab) fireEvent.click(offersTab);
    });

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
  });
});
