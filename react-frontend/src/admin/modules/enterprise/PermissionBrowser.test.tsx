// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/contexts', () => createMockContexts());

// Stub PageHeader to keep tests focused on PermissionBrowser
vi.mock('../../components', () => ({
  PageHeader: ({ title, description }: { title: string; description?: string }) => (
    <div>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
  ),
}));

// Use vi.hoisted so mockGetPermissions is available inside the factory
const { mockGetPermissions } = vi.hoisted(() => ({
  mockGetPermissions: vi.fn(),
}));

vi.mock('../../api/adminApi', () => ({
  adminEnterprise: {
    getPermissions: mockGetPermissions,
  },
}));

import { PermissionBrowser } from './PermissionBrowser';

const SAMPLE_PERMISSIONS: Record<string, string[]> = {
  users: ['users.view', 'users.create', 'users.delete'],
  listings: ['listings.view', 'listings.moderate'],
};

describe('PermissionBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading spinner while data is being fetched', () => {
    // Never resolves during this test
    mockGetPermissions.mockReturnValue(new Promise(() => {}));
    render(<PermissionBrowser />);
    // The loading div has role="status" aria-busy="true"
    const loadingEls = screen.getAllByRole('status');
    const spinner = loadingEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(spinner).toBeInTheDocument();
  });

  it('renders permission categories after loading', async () => {
    mockGetPermissions.mockResolvedValueOnce({
      success: true,
      data: SAMPLE_PERMISSIONS,
    });
    render(<PermissionBrowser />);
    // By data attribute rather than the heading text: the heading is
    // t(`enterprise.permission_categories.${category}`) and no i18n resources
    // load under test, so every category renders the same missing-key output.
    await waitFor(() => {
      const categories = screen
        .getAllByTestId('permission-category-heading')
        .map((heading) => heading.getAttribute('data-category'));
      expect(categories).toContain('users');
      expect(categories).toContain('listings');
    });
  });

  it('renders individual permission chips', async () => {
    mockGetPermissions.mockResolvedValueOnce({
      success: true,
      data: SAMPLE_PERMISSIONS,
    });
    render(<PermissionBrowser />);
    await waitFor(() => {
      expect(screen.getByText('users.view')).toBeInTheDocument();
      expect(screen.getByText('listings.moderate')).toBeInTheDocument();
    });
  });

  it('renders the correct permission count per category', async () => {
    mockGetPermissions.mockResolvedValueOnce({
      success: true,
      data: SAMPLE_PERMISSIONS,
    });
    render(<PermissionBrowser />);
    await waitFor(() => {
      // "users" has 3 perms, "listings" has 2
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  it('hides the loading spinner after data loads', async () => {
    mockGetPermissions.mockResolvedValueOnce({
      success: true,
      data: SAMPLE_PERMISSIONS,
    });
    render(<PermissionBrowser />);
    await waitFor(() => {
      const spinner = screen
        .queryAllByRole('status')
        .find((el) => el.getAttribute('aria-busy') === 'true');
      expect(spinner).toBeUndefined();
    });
  });

  it('renders an empty list when the API returns no categories', async () => {
    mockGetPermissions.mockResolvedValueOnce({ success: true, data: {} });
    render(<PermissionBrowser />);
    await waitFor(() => {
      // Nothing from sample permissions should appear
      expect(screen.queryByText('users')).not.toBeInTheDocument();
    });
  });

  it('handles API failure gracefully (no crash)', async () => {
    mockGetPermissions.mockRejectedValueOnce(new Error('Network error'));
    render(<PermissionBrowser />);
    await waitFor(() => {
      // Loading should finish (finally block)
      const spinner = screen
        .queryAllByRole('status')
        .find((el) => el.getAttribute('aria-busy') === 'true');
      expect(spinner).toBeUndefined();
    });
  });

  it('renders the page heading', async () => {
    mockGetPermissions.mockResolvedValueOnce({ success: true, data: {} });
    render(<PermissionBrowser />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /permission browser/i })).toBeInTheDocument();
    });
  });
});
