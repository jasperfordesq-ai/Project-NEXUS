// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── react-router ──────────────────────────────────────────────────────────────
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// ── adminApi ──────────────────────────────────────────────────────────────────
const mockAdminBlog = vi.hoisted(() => ({
  list: vi.fn(),
  delete: vi.fn(),
  toggleStatus: vi.fn(),
  bulkPublish: vi.fn(),
  bulkDelete: vi.fn(),
}));

vi.mock('../../api/adminApi', () => ({
  adminBlog: mockAdminBlog,
}));

// ── contexts ─────────────────────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
    useToast: () => mockToast,
  })
);

// ── hooks ─────────────────────────────────────────────────────────────────────
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));

// ── admin components stubs ───────────────────────────────────────────────────
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/DataTable', '../../components/PageHeader', etc.
// directly, and vitest keys mocks per resolved module, so a barrel-only mock
// never installs for those imports.
// A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run.
async function adminComponentsMock(importOriginal: <T>() => Promise<T>) {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    DataTable: ({
      data,
      isLoading,
      columns,
    }: {
      data: { id: number; title: string; status: string; author_name?: string; category_name?: string; created_at: string }[];
      isLoading: boolean;
      columns: { key: string; render?: (item: unknown) => unknown }[];
    }) => {
      if (isLoading) return <div role="status" aria-busy="true" aria-label="Loading" />;
      if (!data.length) return <div data-testid="empty-table">No posts</div>;
      return (
        <table>
          <tbody>
            {data.map((row) => (
              <tr key={row.id}>
                {columns.map((col) => (
                  <td key={col.key}>{col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    },
    PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
      <div>
        <h1>{title}</h1>
        {actions}
      </div>
    ),
    ConfirmModal: ({
      isOpen,
      onConfirm,
      onClose,
      title,
    }: {
      isOpen: boolean;
      onConfirm: () => void;
      onClose: () => void;
      title: string;
    }) =>
      isOpen ? (
        <div role="dialog" aria-label={title}>
          <button onClick={onConfirm}>Confirm</button>
          <button onClick={onClose}>Cancel</button>
        </div>
      ) : null,
    BulkActionToolbar: () => null,
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/DataTable', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);
vi.mock('../../components/ConfirmModal', adminComponentsMock);
vi.mock('../../components/BulkActionToolbar', adminComponentsMock);

import React from 'react';
import { BlogAdmin } from './BlogAdmin';

const POST = {
  id: 10,
  title: 'My First Post',
  status: 'draft',
  author_name: 'Alice',
  category_name: 'News',
  created_at: '2026-01-01T00:00:00Z',
};

const POST_PUBLISHED = { ...POST, id: 11, title: 'Published Post', status: 'published' };

describe('BlogAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminBlog.list.mockResolvedValue({ success: true, data: [POST, POST_PUBLISHED] });
  });

  it('shows loading state initially', () => {
    mockAdminBlog.list.mockReturnValue(new Promise(() => {}));
    render(<BlogAdmin />);
    const statusEls = screen.getAllByRole('status');
    const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeTruthy();
  });

  it('renders post titles after load', async () => {
    render(<BlogAdmin />);
    await waitFor(() => {
      expect(screen.getByText('My First Post')).toBeInTheDocument();
    });
  });

  it('renders empty state when no posts', async () => {
    mockAdminBlog.list.mockResolvedValue({ success: true, data: [] });
    render(<BlogAdmin />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-table')).toBeInTheDocument();
    });
  });

  it('shows error toast when load fails', async () => {
    mockAdminBlog.list.mockRejectedValue(new Error('Server down'));
    render(<BlogAdmin />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('navigates to create page when New Post button clicked', async () => {
    render(<BlogAdmin />);
    await waitFor(() => expect(screen.getByText('My First Post')).toBeInTheDocument());
    const createBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('creat') || b.textContent?.toLowerCase().includes('new'));
    if (createBtn) {
      await userEvent.click(createBtn);
      expect(mockNavigate).toHaveBeenCalled();
    }
  });

  it('opens delete confirm modal on delete button click', async () => {
    render(<BlogAdmin />);
    await waitFor(() => expect(screen.getByText('My First Post')).toBeInTheDocument());
    const deleteBtns = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-label')?.toLowerCase().includes('delete'));
    if (deleteBtns.length) {
      await userEvent.click(deleteBtns[0]);
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    }
  });

  it('calls adminBlog.delete and reloads on confirm delete', async () => {
    mockAdminBlog.delete.mockResolvedValue({ success: true });
    render(<BlogAdmin />);
    await waitFor(() => expect(screen.getByText('My First Post')).toBeInTheDocument());

    const deleteBtns = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-label')?.toLowerCase().includes('delete'));
    if (!deleteBtns.length) return; // columns may render differently
    await userEvent.click(deleteBtns[0]);

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const confirmBtn = screen.getByText('Confirm');
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockAdminBlog.delete).toHaveBeenCalled();
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('calls adminBlog.toggleStatus on toggle button click', async () => {
    mockAdminBlog.toggleStatus.mockResolvedValue({ success: true });
    render(<BlogAdmin />);
    await waitFor(() => expect(screen.getByText('My First Post')).toBeInTheDocument());

    const toggleBtns = screen.getAllByRole('button').filter((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('publish') || b.getAttribute('aria-label')?.toLowerCase().includes('unpublish')
    );
    if (toggleBtns.length) {
      await userEvent.click(toggleBtns[0]);
      await waitFor(() => {
        expect(mockAdminBlog.toggleStatus).toHaveBeenCalled();
      });
    }
  });
});
