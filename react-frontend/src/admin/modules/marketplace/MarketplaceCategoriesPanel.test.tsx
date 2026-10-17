// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  })
);

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api } from '@/lib/api';
import { MarketplaceCategoriesPanel } from './MarketplaceCategoriesPanel';
import type { MarketplaceAdminCategory } from './marketplaceCategoriesApi';

const platformRow: MarketplaceAdminCategory = {
  id: 1,
  name: 'Electronics',
  slug: 'electronics',
  description: null,
  icon: 'Smartphone',
  parent_id: null,
  sort_order: 1,
  is_active: true,
  is_platform: true,
  listing_count: 4,
  updated_at: '2026-10-17T10:00:00Z',
};

const ownRow: MarketplaceAdminCategory = {
  id: 10,
  name: 'Garden tools',
  slug: 'garden-tools',
  description: 'Spades, rakes and the like',
  icon: 'Wrench',
  parent_id: null,
  sort_order: 20,
  is_active: true,
  is_platform: false,
  listing_count: 2,
  updated_at: '2026-10-17T10:00:00Z',
};

const ownRowB: MarketplaceAdminCategory = {
  ...ownRow,
  id: 11,
  name: 'Bikes',
  slug: 'bikes',
  description: null,
  icon: null,
  sort_order: 21,
  listing_count: 0,
};

function mockList(rows: MarketplaceAdminCategory[]) {
  vi.mocked(api.get).mockResolvedValue({ success: true, data: rows });
}

describe('MarketplaceCategoriesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads and groups own and shared categories, with shared rows read-only', async () => {
    mockList([platformRow, ownRow]);
    render(<MarketplaceCategoriesPanel />);

    await waitFor(() => {
      expect(screen.getByText('Garden tools')).toBeInTheDocument();
      expect(screen.getByText('Electronics')).toBeInTheDocument();
    });
    expect(api.get).toHaveBeenCalledWith('/v2/admin/marketplace/categories');

    // Shared row: chip present, no edit/delete controls.
    const shared = screen.getByTestId('category-row-1');
    expect(within(shared).getByText('Shared')).toBeInTheDocument();
    expect(within(shared).queryByRole('button', { name: /Edit Electronics/ })).not.toBeInTheDocument();
    expect(within(shared).queryByRole('button', { name: /Delete Electronics/ })).not.toBeInTheDocument();

    // Own row: full controls, listing count shown.
    const own = screen.getByTestId('category-row-10');
    expect(within(own).getByRole('button', { name: 'Edit Garden tools' })).toBeInTheDocument();
    expect(within(own).getByRole('button', { name: 'Delete Garden tools' })).toBeInTheDocument();
    expect(within(own).getByText(/2 active listings/)).toBeInTheDocument();
  });

  it('shows an error state with retry when the load fails', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: false, error: 'Server exploded' });
    render(<MarketplaceCategoriesPanel />);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Could not load categories')).toBeInTheDocument();
    expect(screen.queryByText('Server exploded')).not.toBeInTheDocument();

    mockList([ownRow]);
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('Garden tools')).toBeInTheDocument());
  });

  it('shows the empty state for a community with no categories of its own', async () => {
    mockList([platformRow]);
    render(<MarketplaceCategoriesPanel />);
    expect(await screen.findByText(/have not added any categories of your own/)).toBeInTheDocument();
  });

  it('adds a category and reloads the list', async () => {
    mockList([platformRow]);
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { ...ownRow, id: 42, name: 'Toys' } });
    render(<MarketplaceCategoriesPanel />);
    await screen.findByText('Electronics');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    const form = screen.getByRole('region', { name: 'New category' });
    await user.type(within(form).getByLabelText(/^Name/), 'Toys');
    await user.click(within(form).getByRole('button', { name: 'Add category' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v2/admin/marketplace/categories', {
        name: 'Toys',
        parent_id: null,
        icon: null,
        description: null,
      });
    });
    expect(mockToast.success).toHaveBeenCalledWith('Category added');
    // Initial load + reload after the add.
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('refuses to submit an empty name without calling the server', async () => {
    mockList([]);
    render(<MarketplaceCategoriesPanel />);
    await screen.findByText(/have not added any categories/);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    const form = screen.getByRole('region', { name: 'New category' });
    await user.click(within(form).getByRole('button', { name: 'Add category' }));

    expect(await screen.findByText('Give the category a name.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('surfaces a duplicate-name 422 under the name field', async () => {
    mockList([]);
    vi.mocked(api.post).mockResolvedValue({
      success: false,
      error: 'That name is already taken',
      code: 'VALIDATION_ERROR',
      errors: [{ code: 'VALIDATION_ERROR', message: 'That name is already taken', field: 'name' }],
    });
    render(<MarketplaceCategoriesPanel />);
    await screen.findByText(/have not added any categories/);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    const form = screen.getByRole('region', { name: 'New category' });
    await user.type(within(form).getByLabelText(/^Name/), 'Electronics');
    await user.click(within(form).getByRole('button', { name: 'Add category' }));

    // The panel explains the blamed field in the UI's own language rather than
    // echoing the server's message, which is rendered in the server's locale.
    expect(await screen.findByText(/already used by another category/)).toBeInTheDocument();
    expect(screen.queryByText('That name is already taken')).not.toBeInTheDocument();
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('hides a category via the show/hide control', async () => {
    mockList([ownRow]);
    vi.mocked(api.put).mockResolvedValue({ success: true, data: { ...ownRow, is_active: false } });
    render(<MarketplaceCategoriesPanel />);
    await screen.findByText('Garden tools');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Hide Garden tools from members' }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/v2/admin/marketplace/categories/10', { is_active: false });
    });
    expect(mockToast.success).toHaveBeenCalledWith('Category hidden from members');
  });

  it('reorders by sending the full own-category id list', async () => {
    mockList([platformRow, ownRow, ownRowB]);
    vi.mocked(api.put).mockResolvedValue({ success: true, data: { reordered: 2 } });
    render(<MarketplaceCategoriesPanel />);
    await screen.findByText('Bikes');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Move Bikes up' }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/v2/admin/marketplace/categories/reorder', { ids: [11, 10] });
    });
  });

  it('deletes after confirmation', async () => {
    mockList([ownRow]);
    vi.mocked(api.delete).mockResolvedValue({ success: true, data: { deleted: 1 } });
    render(<MarketplaceCategoriesPanel />);
    await screen.findByText('Garden tools');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete Garden tools' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/v2/admin/marketplace/categories/10');
    });
    expect(mockToast.success).toHaveBeenCalledWith('Category deleted');
  });

  it('offers "Hide instead" when the server refuses a delete with 409 CATEGORY_IN_USE', async () => {
    mockList([ownRow]);
    vi.mocked(api.delete).mockResolvedValue({
      success: false,
      code: 'CATEGORY_IN_USE',
      error: '2 listings still use this category.',
      errors: [{ code: 'CATEGORY_IN_USE', message: '2 listings still use this category.' }],
    });
    vi.mocked(api.put).mockResolvedValue({ success: true, data: { ...ownRow, is_active: false } });
    render(<MarketplaceCategoriesPanel />);
    await screen.findByText('Garden tools');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete Garden tools' }));
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));

    // The refusal names the category in the UI's language, and nothing was deleted.
    expect(await screen.findByText('Listings still use "Garden tools", so it cannot be deleted.')).toBeInTheDocument();
    expect(mockToast.success).not.toHaveBeenCalledWith('Category deleted');

    await user.click(screen.getByRole('button', { name: 'Hide instead' }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/v2/admin/marketplace/categories/10', { is_active: false });
    });
    expect(mockToast.success).toHaveBeenCalledWith('Category hidden from members');
  });

  it('edits a category inline and sends the changed fields', async () => {
    mockList([ownRow]);
    vi.mocked(api.put).mockResolvedValue({ success: true, data: { ...ownRow, name: 'Garden & tools' } });
    render(<MarketplaceCategoriesPanel />);
    await screen.findByText('Garden tools');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit Garden tools' }));
    const row = screen.getByTestId('category-row-10');
    const name = within(row).getByLabelText(/^Name/);
    await user.clear(name);
    await user.type(name, 'Garden & tools');
    await user.click(within(row).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/v2/admin/marketplace/categories/10', {
        name: 'Garden & tools',
        parent_id: null,
        icon: 'Wrench',
        description: 'Spades, rakes and the like',
      });
    });
    expect(mockToast.success).toHaveBeenCalledWith('Category saved');
  });
});
