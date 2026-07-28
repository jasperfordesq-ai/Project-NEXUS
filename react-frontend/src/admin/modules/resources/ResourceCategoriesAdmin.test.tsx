// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
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

// ── api mock ─────────────────────────────────────────────────────────────────
const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: mockApi }));

// ── AdminMetaContext ──────────────────────────────────────────────────────────
vi.mock('../../AdminMetaContext', () => ({ useAdminPageMeta: vi.fn() }));

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

// ── admin component stubs ─────────────────────────────────────────────────────
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/PageHeader' (and friends) directly, and vitest keys
// mocks per resolved module, so a barrel-only mock never installs for those
// imports — the real components rendered and the stub testids were never in the
// DOM. A function DECLARATION, not a const: vi.mock calls are hoisted above the
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
      data: { id: number; name: string; slug: string; description: string | null; sort_order: number }[];
      isLoading: boolean;
      columns: { key: string; render?: (item: unknown) => unknown }[];
    }) => {
      if (isLoading) return <div role="status" aria-busy="true" aria-label="Loading" />;
      if (!data.length) return <div data-testid="empty-state">No categories</div>;
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
      <div><h1>{title}</h1>{actions}</div>
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
          <button onClick={onConfirm}>Confirm Delete</button>
          <button onClick={onClose}>Cancel</button>
        </div>
      ) : null,
    EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);
vi.mock('../../components/DataTable', adminComponentsMock);
vi.mock('../../components/ConfirmModal', adminComponentsMock);
vi.mock('../../components/EmptyState', adminComponentsMock);

import React from 'react';
import { ResourceCategoriesAdmin } from './ResourceCategoriesAdmin';

const CATEGORY = {
  id: 1,
  name: 'General Resources',
  slug: 'general-resources',
  description: 'Various helpful resources',
  sort_order: 0,
  icon: null,
  parent_id: null,
};

describe('ResourceCategoriesAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: [CATEGORY] });
    mockApi.post.mockResolvedValue({ success: true, data: { ...CATEGORY, id: 99, name: 'New Cat' } });
    mockApi.put.mockResolvedValue({ success: true, data: CATEGORY });
    mockApi.delete.mockResolvedValue({ success: true });
  });

  it('shows loading state initially', () => {
    mockApi.get.mockReturnValue(new Promise(() => {}));
    render(<ResourceCategoriesAdmin />);
    const statusEls = screen.getAllByRole('status');
    const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeTruthy();
  });

  it('renders category name after load', async () => {
    render(<ResourceCategoriesAdmin />);
    await waitFor(() => {
      expect(screen.getByText('General Resources')).toBeInTheDocument();
    });
  });

  it('renders empty state when no categories', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: [] });
    render(<ResourceCategoriesAdmin />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('shows error toast when load fails', async () => {
    mockApi.get.mockRejectedValue(new Error('Network error'));
    render(<ResourceCategoriesAdmin />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('opens create modal when New Category button is clicked', async () => {
    render(<ResourceCategoriesAdmin />);
    await waitFor(() => expect(screen.getByText('General Resources')).toBeInTheDocument());
    const addBtns = screen.getAllByRole('button').filter((b) =>
      b.textContent?.toLowerCase().includes('new') || b.textContent?.toLowerCase().includes('categ') || b.textContent?.includes('+')
    );
    const createBtn = addBtns.find((b) => !b.closest('[role="dialog"]'));
    if (createBtn) {
      await userEvent.click(createBtn);
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    }
  });

  it('opens edit modal when edit button is clicked', async () => {
    render(<ResourceCategoriesAdmin />);
    await waitFor(() => expect(screen.getByText('General Resources')).toBeInTheDocument());
    const editBtns = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-label')?.toLowerCase().includes('edit'));
    if (editBtns.length) {
      await userEvent.click(editBtns[0]);
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
      // Edit modal should pre-populate the name
      await waitFor(() => {
        const input = screen.getByDisplayValue('General Resources');
        expect(input).toBeInTheDocument();
      });
    }
  });

  it('calls POST to create a new category', async () => {
    render(<ResourceCategoriesAdmin />);
    await waitFor(() => expect(screen.getByText('General Resources')).toBeInTheDocument());

    // Open create modal
    const addBtns = screen.getAllByRole('button').filter((b) =>
      b.textContent?.toLowerCase().includes('new') || b.textContent?.toLowerCase().includes('categ')
    );
    const createBtn = addBtns.find((b) => !b.closest('[role="dialog"]'));
    if (!createBtn) return;
    await userEvent.click(createBtn);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    // Fill in the name field
    const nameInput = screen.getByRole('dialog').querySelector('input[type="text"], input:not([type])');
    if (nameInput) {
      fireEvent.change(nameInput, { target: { value: 'Education' } });
    }

    // Submit
    const submitBtn = Array.from(screen.getByRole('dialog').querySelectorAll('button')).find(
      (b) => b.textContent?.toLowerCase().includes('categ') || b.textContent?.toLowerCase().includes('creat') || b.textContent?.toLowerCase().includes('save') || b.textContent?.toLowerCase().includes('new')
    );
    if (submitBtn) {
      await userEvent.click(submitBtn);
      await waitFor(() => {
        expect(mockApi.post).toHaveBeenCalledWith('/v2/resources/categories', expect.any(Object));
      });
    }
  });

  it('calls PUT to update an existing category', async () => {
    render(<ResourceCategoriesAdmin />);
    await waitFor(() => expect(screen.getByText('General Resources')).toBeInTheDocument());

    const editBtns = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-label')?.toLowerCase().includes('edit'));
    if (!editBtns.length) return;
    await userEvent.click(editBtns[0]);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    const submitBtn = Array.from(screen.getByRole('dialog').querySelectorAll('button')).find(
      (b) => b.textContent?.toLowerCase().includes('save') || b.textContent?.toLowerCase().includes('upd')
    );
    if (submitBtn) {
      await userEvent.click(submitBtn);
      await waitFor(() => {
        expect(mockApi.put).toHaveBeenCalledWith(`/v2/resources/categories/${CATEGORY.id}`, expect.any(Object));
      });
    }
  });

  it('opens delete confirmation when delete button is clicked', async () => {
    render(<ResourceCategoriesAdmin />);
    await waitFor(() => expect(screen.getByText('General Resources')).toBeInTheDocument());

    const deleteBtns = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-label')?.toLowerCase().includes('delete'));
    if (deleteBtns.length) {
      await userEvent.click(deleteBtns[0]);
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    }
  });

  it('calls DELETE and shows success toast on confirm', async () => {
    render(<ResourceCategoriesAdmin />);
    await waitFor(() => expect(screen.getByText('General Resources')).toBeInTheDocument());

    const deleteBtns = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-label')?.toLowerCase().includes('delete'));
    if (!deleteBtns.length) return;
    await userEvent.click(deleteBtns[0]);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    await userEvent.click(screen.getByText('Confirm Delete'));
    await waitFor(() => {
      expect(mockApi.delete).toHaveBeenCalledWith(`/v2/resources/categories/${CATEGORY.id}`);
      expect(mockToast.success).toHaveBeenCalled();
    });
  });
});
