// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mock api (default import) ────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  default: mockApi,
  api: mockApi,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Contexts / Hooks ─────────────────────────────────────────────────────────
vi.mock('@/contexts', () => createMockContexts());
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// ─── Stub admin components ────────────────────────────────────────────────────
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/EmptyState' and '../../components/PageHeader'
// directly, and vitest keys mocks per resolved module, so a barrel-only mock
// never installs for those imports.
// A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run.
function adminComponentsMock() {
  return {
    EmptyState: ({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) => (
      <div data-testid="empty-state">
        <span>{title}</span>
        {actionLabel && onAction && (
          <button onClick={onAction}>{actionLabel}</button>
        )}
      </div>
    ),
    PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
      <div data-testid="page-header">
        <span>{title}</span>
        {actions}
      </div>
    ),
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/EmptyState', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeProject = (overrides = {}) => ({
  id: 1,
  title: 'Test Project',
  summary: 'A summary',
  location: 'Dublin',
  status: 'draft' as const,
  current_stage: 'Planning',
  progress_percent: 25,
  subscriber_count: 10,
  last_update_at: null,
  published_at: null,
  created_at: '2025-01-01T00:00:00Z',
  ...overrides,
});

const makeListResponse = (data: object[] = []) => ({ success: true, data });
const makeActionResponse = () => ({ success: true });

// ─────────────────────────────────────────────────────────────────────────────
describe('ProjectAnnouncementsAdminPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue(makeListResponse());
  });

  it('shows loading spinner while fetching projects', async () => {
    mockApi.get.mockImplementationOnce(() => new Promise(() => {}));
    const { default: Page } = await import('./ProjectAnnouncementsAdminPage');
    render(<Page />);

    const statuses = screen.getAllByRole('status');
    const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders empty state when no projects returned', async () => {
    const { default: Page } = await import('./ProjectAnnouncementsAdminPage');
    render(<Page />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('shows error message when API fails', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('network error'));
    const { default: Page } = await import('./ProjectAnnouncementsAdminPage');
    render(<Page />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('renders project title when projects are returned', async () => {
    mockApi.get.mockResolvedValue(makeListResponse([makeProject()]));
    const { default: Page } = await import('./ProjectAnnouncementsAdminPage');
    render(<Page />);

    await waitFor(() => {
      expect(screen.getByText('Test Project')).toBeInTheDocument();
    });
  });

  it('renders progress and subscriber count for a project', async () => {
    mockApi.get.mockResolvedValue(makeListResponse([makeProject({ subscriber_count: 42 })]));
    const { default: Page } = await import('./ProjectAnnouncementsAdminPage');
    render(<Page />);

    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument();
    });
  });

  it('shows Publish button for draft projects', async () => {
    mockApi.get.mockResolvedValue(makeListResponse([makeProject({ status: 'draft' })]));
    const { default: Page } = await import('./ProjectAnnouncementsAdminPage');
    render(<Page />);

    await waitFor(() => {
      const btns = screen.getAllByRole('button');
      const publishBtn = btns.find((b) =>
        b.textContent?.toLowerCase().includes('publish')
      );
      expect(publishBtn).toBeDefined();
    });
  });

  it('shows Pause button for active projects', async () => {
    mockApi.get.mockResolvedValue(makeListResponse([makeProject({ status: 'active' })]));
    const { default: Page } = await import('./ProjectAnnouncementsAdminPage');
    render(<Page />);

    await waitFor(() => {
      const btns = screen.getAllByRole('button');
      const pauseBtn = btns.find((b) =>
        b.textContent?.toLowerCase().includes('pause')
      );
      expect(pauseBtn).toBeDefined();
    });
  });

  it('calls POST publish endpoint when Publish button clicked', async () => {
    mockApi.get.mockResolvedValue(makeListResponse([makeProject({ status: 'draft', id: 5 })]));
    mockApi.post.mockResolvedValue(makeActionResponse());
    const { default: Page } = await import('./ProjectAnnouncementsAdminPage');
    render(<Page />);

    await waitFor(() => screen.getByText('Test Project'));

    const publishBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('publish')
    );
    fireEvent.click(publishBtn!);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        '/v2/admin/caring-community/projects/5/publish'
      );
    });
  });

  it('calls PUT with paused status when Pause is clicked', async () => {
    mockApi.get.mockResolvedValue(makeListResponse([makeProject({ status: 'active', id: 3 })]));
    mockApi.put.mockResolvedValue(makeActionResponse());
    const { default: Page } = await import('./ProjectAnnouncementsAdminPage');
    render(<Page />);

    await waitFor(() => screen.getByText('Test Project'));

    const pauseBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('pause')
    );
    fireEvent.click(pauseBtn!);

    await waitFor(() => {
      expect(mockApi.put).toHaveBeenCalledWith(
        '/v2/admin/caring-community/projects/3',
        { status: 'paused' }
      );
    });
  });

  it('opens create project modal on Create Project button click', async () => {
    const { default: Page } = await import('./ProjectAnnouncementsAdminPage');
    render(<Page />);

    await waitFor(() => screen.getByTestId('page-header'));

    const createBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('create') ||
      b.textContent?.toLowerCase().includes('project')
    );
    expect(createBtn).toBeDefined();
    fireEvent.click(createBtn!);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('submits create project POST with correct payload', async () => {
    mockApi.post.mockResolvedValue(makeActionResponse());
    const { default: Page } = await import('./ProjectAnnouncementsAdminPage');
    render(<Page />);

    await waitFor(() => screen.getByTestId('page-header'));

    // Open create modal
    const createBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('create') ||
      b.textContent?.toLowerCase().includes('project')
    );
    fireEvent.click(createBtn!);
    await waitFor(() => screen.getByRole('dialog'));

    // Fill in title input
    const inputs = screen.getAllByRole('textbox');
    // First text input in modal should be the title field
    const titleInput = inputs[0];
    fireEvent.change(titleInput, { target: { value: 'My New Project' } });

    // Click submit button (not cancel)
    const submitBtn = screen.getAllByRole('button').find((b) =>
      !b.textContent?.toLowerCase().includes('cancel') &&
      (b.textContent?.toLowerCase().includes('create') ||
       b.textContent?.toLowerCase().includes('submit'))
    );
    expect(submitBtn).toBeDefined();
    fireEvent.click(submitBtn!);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        '/v2/admin/caring-community/projects',
        expect.objectContaining({ title: 'My New Project' })
      );
    });
  });

  it('opens update modal when Add Update is clicked', async () => {
    mockApi.get.mockResolvedValue(makeListResponse([makeProject({ status: 'active' })]));
    const { default: Page } = await import('./ProjectAnnouncementsAdminPage');
    render(<Page />);

    await waitFor(() => screen.getByText('Test Project'));

    const updateBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('update')
    );
    expect(updateBtn).toBeDefined();
    fireEvent.click(updateBtn!);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('does not show Publish or Pause for completed projects', async () => {
    mockApi.get.mockResolvedValue(makeListResponse([makeProject({ status: 'completed' })]));
    const { default: Page } = await import('./ProjectAnnouncementsAdminPage');
    render(<Page />);

    await waitFor(() => screen.getByText('Test Project'));

    const publishBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase() === 'publish'
    );
    const pauseBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase() === 'pause'
    );
    expect(publishBtn).toBeUndefined();
    expect(pauseBtn).toBeUndefined();
  });
});
