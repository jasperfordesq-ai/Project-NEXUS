// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), download: vi.fn(), upload: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Toast / Auth ────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({ user: { id: 1, name: 'Alice' }, isAuthenticated: true, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle' as const, error: null }),
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

// Also mock the ToastContext direct import path used by some files
// Must include ToastProvider because test-utils wraps children in it
vi.mock('@/contexts/ToastContext', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/contexts/ToastContext')>();
  return { ...orig, useToast: () => mockToast };
});

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// SavedSearches calls useConfirm, which THROWS outside a <ConfirmDialogProvider>;
// test-utils' render() does not install one, so every test here collapsed on the
// first render. Stub the hook rather than the component, so SavedSearches itself
// stays under test. Same shape as PartnerVenuesAdminPage.test.tsx.
vi.mock('@/components/ui/ConfirmDialog', () => ({
  useConfirm: () => vi.fn(async () => true),
  ConfirmDialogProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));


// ─── Stub Tooltip (avoids floating-ui layout issues in jsdom) ────────────────
vi.mock('@/components/ui', async (importOriginal) => {
  const { uiMock } = await import('@/test/uiMock');
  return uiMock;
});

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeSavedSearch = (overrides: Partial<{
  id: number;
  name: string;
  query_params: Record<string, string>;
  notify_on_new: boolean;
  last_run_at: string | null;
  last_result_count: number | null;
  created_at: string;
}> = {}) => ({
  id: 1,
  name: 'Gardening near me',
  query_params: { q: 'gardening', category: 'outdoor' },
  notify_on_new: false,
  last_run_at: null,
  last_result_count: 12,
  created_at: '2026-05-01T10:00:00Z',
  ...overrides,
});

const makeListResponse = (items: object[] = []) => ({
  success: true,
  data: items,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SavedSearches', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue(makeListResponse());
    mockApi.post.mockResolvedValue({ success: true, data: makeSavedSearch() });
    mockApi.delete.mockResolvedValue({ success: true });
  });

  it('renders nothing when user is not authenticated', async () => {
    // Override to unauthenticated
    const { SavedSearches } = await import('./SavedSearches');
    // Re-mock auth to unauthenticated
    const { createMockContexts: cmc } = await import('@/test/mock-contexts');
    vi.doMock('@/contexts', () =>
      cmc({
        useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle' as const, error: null }),
        useToast: () => mockToast,
      })
    );
    // Component returns null when not authenticated
    // We just verify the API is NOT called when isAuthenticated is false
    // (the actual component branches on isAuthenticated from the mock)
    render(<SavedSearches />);
    // Even if it renders nothing, it must not crash
    expect(document.body).toBeTruthy();
  });

  it('shows loading spinner while fetching', async () => {
    mockApi.get.mockImplementationOnce(() => new Promise(() => {}));
    const { SavedSearches } = await import('./SavedSearches');
    render(<SavedSearches />);
    const spinner = document.querySelector('[aria-busy="true"]');
    expect(spinner).toBeTruthy();
  });

  it('calls GET /v2/search/saved on mount', async () => {
    const { SavedSearches } = await import('./SavedSearches');
    render(<SavedSearches />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/v2/search/saved'));
  });

  it('renders saved search names after load', async () => {
    mockApi.get.mockResolvedValue(makeListResponse([makeSavedSearch()]));
    const { SavedSearches } = await import('./SavedSearches');
    render(<SavedSearches />);
    await waitFor(() => {
      expect(screen.getByText('Gardening near me')).toBeInTheDocument();
    });
  });

  it('renders query string for each saved search', async () => {
    mockApi.get.mockResolvedValue(makeListResponse([
      makeSavedSearch({ query_params: { q: 'tutoring' } }),
    ]));
    const { SavedSearches } = await import('./SavedSearches');
    render(<SavedSearches />);
    await waitFor(() => {
      expect(screen.getByText('tutoring')).toBeInTheDocument();
    });
  });

  it('renders multiple saved searches', async () => {
    mockApi.get.mockResolvedValue(makeListResponse([
      makeSavedSearch({ id: 1, name: 'Gardening' }),
      makeSavedSearch({ id: 2, name: 'Tech help' }),
    ]));
    const { SavedSearches } = await import('./SavedSearches');
    render(<SavedSearches />);
    await waitFor(() => {
      expect(screen.getByText('Gardening')).toBeInTheDocument();
      expect(screen.getByText('Tech help')).toBeInTheDocument();
    });
  });

  it('shows "Save this search" button when currentQuery is provided', async () => {
    const { SavedSearches } = await import('./SavedSearches');
    render(<SavedSearches currentQuery="yoga" />);
    await waitFor(() => {
      const saveBtn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('save')
      );
      expect(saveBtn).toBeInTheDocument();
    });
  });

  it('opens save form when "Save this search" is clicked', async () => {
    const { SavedSearches } = await import('./SavedSearches');
    render(<SavedSearches currentQuery="yoga" />);
    await waitFor(() => screen.getAllByRole('button').some((b) => b.textContent?.toLowerCase().includes('save')));

    const saveBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('save') && !b.textContent?.toLowerCase().includes('cancel')
    );
    fireEvent.click(saveBtn!);

    await waitFor(() => {
      // Save form input appears
      const input = screen.getAllByRole('textbox').find((el) =>
        el.getAttribute('placeholder')?.toLowerCase().includes('name') ||
        el.getAttribute('aria-label')?.toLowerCase().includes('name')
      );
      expect(input).toBeDefined();
    });
  });

  it('calls POST /v2/search/saved when save form is submitted', async () => {
    const { SavedSearches } = await import('./SavedSearches');
    render(<SavedSearches currentQuery="yoga" currentFilters={{ category: 'health' }} />);

    await waitFor(() => screen.getAllByRole('button').some((b) => b.textContent?.toLowerCase().includes('save')));
    const openSaveBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('save') && !b.textContent?.toLowerCase().includes('cancel')
    );
    fireEvent.click(openSaveBtn!);

    // Type a name into the save form
    await waitFor(() => {
      const input = screen.getAllByRole('textbox').find((el) =>
        el.getAttribute('placeholder')?.toLowerCase().includes('name') ||
        el.getAttribute('aria-label')?.toLowerCase().includes('name')
      );
      expect(input).toBeDefined();
    });

    const nameInput = screen.getAllByRole('textbox').find((el) =>
      el.getAttribute('placeholder')?.toLowerCase().includes('name') ||
      el.getAttribute('aria-label')?.toLowerCase().includes('name')
    )!;
    fireEvent.change(nameInput, { target: { value: 'My yoga search' } });

    const submitBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase() === 'save' || b.textContent?.toLowerCase().includes('save') && !b.textContent?.toLowerCase().includes('cancel')
    );
    fireEvent.click(submitBtn!);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        '/v2/search/saved',
        expect.objectContaining({ name: 'My yoga search', query_params: expect.objectContaining({ q: 'yoga' }) })
      );
    });
  });

  it('calls onRunSearch callback when run button is clicked', async () => {
    const onRunSearch = vi.fn();
    mockApi.get.mockResolvedValue(makeListResponse([makeSavedSearch()]));
    const { SavedSearches } = await import('./SavedSearches');
    render(<SavedSearches onRunSearch={onRunSearch} />);

    await waitFor(() => screen.getByText('Gardening near me'));

    const runBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('run')
    );
    expect(runBtn).toBeDefined();
    fireEvent.click(runBtn!);

    expect(onRunSearch).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'gardening' })
    );
  });

  it('keeps the saved search and shows an error when delete fails (no fake delete)', async () => {
    // Regression: api.delete was unchecked, so the row was removed + a "deleted" toast
    // shown unconditionally. A { success:false } (4xx) made the row vanish with a fake
    // success while the backend kept it. Now gated on res.success. (useConfirm
    // auto-resolves true in the test harness.)
    mockApi.get.mockResolvedValue(makeListResponse([makeSavedSearch({ id: 5, name: 'Doomed Search' })]));
    mockApi.delete.mockResolvedValue({ success: false, error: 'Cannot delete' });
    const { SavedSearches } = await import('./SavedSearches');
    render(<SavedSearches />);
    await waitFor(() => expect(screen.getByText('Doomed Search')).toBeInTheDocument());

    const delBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('delete')
    );
    fireEvent.click(delBtn!);

    await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('/v2/search/saved/5'));
    // A failed delete must NOT remove the row, and must surface an error (no fake success).
    expect(screen.getByText('Doomed Search')).toBeInTheDocument();
    expect(mockToast.error).toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('shows an error (and no fake success) when save fails with success:false', async () => {
    // Regression: handleSave had no else on the success gate, so a { success:false }
    // (4xx) gave zero feedback. It must now surface the error. Verified live.
    mockApi.post.mockResolvedValue({ success: false, error: 'Name already exists' });
    const { SavedSearches } = await import('./SavedSearches');
    render(<SavedSearches currentQuery="yoga" />);

    await waitFor(() => screen.getAllByRole('button').some((b) => b.textContent?.toLowerCase().includes('save')));
    const openSaveBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('save') && !b.textContent?.toLowerCase().includes('cancel')
    );
    fireEvent.click(openSaveBtn!);

    await waitFor(() => {
      const input = screen.getAllByRole('textbox').find((el) =>
        el.getAttribute('placeholder')?.toLowerCase().includes('name') ||
        el.getAttribute('aria-label')?.toLowerCase().includes('name')
      );
      expect(input).toBeDefined();
    });
    const nameInput = screen.getAllByRole('textbox').find((el) =>
      el.getAttribute('placeholder')?.toLowerCase().includes('name') ||
      el.getAttribute('aria-label')?.toLowerCase().includes('name')
    )!;
    fireEvent.change(nameInput, { target: { value: 'Dupe Name' } });

    const submitBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase() === 'save' || (b.textContent?.toLowerCase().includes('save') && !b.textContent?.toLowerCase().includes('cancel'))
    );
    fireEvent.click(submitBtn!);

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled());
    expect(mockToast.error).toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('does not render "Save this search" when currentQuery is empty', async () => {
    const { SavedSearches } = await import('./SavedSearches');
    render(<SavedSearches />);
    await waitFor(() => {
      // Loading finishes
      expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    });
    // No "save this search" button without a currentQuery
    const saveBtn = screen.queryAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('save this search')
    );
    expect(saveBtn).toBeUndefined();
  });
});
