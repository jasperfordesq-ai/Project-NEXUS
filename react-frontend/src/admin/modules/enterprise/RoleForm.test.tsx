// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mock adminApi ────────────────────────────────────────────────────────────
const mockAdminEnterprise = vi.hoisted(() => ({
  getPermissions: vi.fn(),
  getRole: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
}));

vi.mock('../../api/adminApi', () => ({
  adminEnterprise: mockAdminEnterprise,
}));

// ─── Mock router ─────────────────────────────────────────────────────────────
const mockNavigate = vi.hoisted(() => vi.fn());
let mockParamId: string | undefined = undefined;

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: mockParamId }),
  };
});

// ─── Mock contexts ───────────────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Sample data ─────────────────────────────────────────────────────────────
// permissionLabel() converts "users" → "Users" and "users.view" → "Users View"
// Mirrors AdminEnterpriseController::PERMISSIONS. These slugs must be REAL:
// the form looks each one up as enterprise.permissions.<token> and falls back to
// "Unknown permission" for anything it does not recognise, so a made-up slug
// (the previous `reports.*` / `content.view`) renders no usable label at all.
const PERMISSIONS: Record<string, string[]> = {
  content: ['content.blog.manage', 'content.pages.manage'],
  users: ['users.view', 'users.create'],
};

import { RoleForm } from './RoleForm';

describe('RoleForm — create mode (no :id param)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParamId = undefined;
  });

  it('shows loading spinner while fetching permissions', () => {
    mockAdminEnterprise.getPermissions.mockReturnValue(new Promise(() => {}));

    render(<RoleForm />);

    const spinner = screen
      .getAllByRole('status')
      .find((el) => el.getAttribute('aria-busy') === 'true');
    expect(spinner).toBeInTheDocument();
  });

  it('renders name input after load (i18n label: "Role Name")', async () => {
    mockAdminEnterprise.getPermissions.mockResolvedValue({
      success: true,
      data: PERMISSIONS,
    });

    render(<RoleForm />);

    // i18n: enterprise.label_role_name → "Role Name"
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /Role Name/i })).toBeInTheDocument();
    });
  });

  it('renders permission category checkboxes', async () => {
    mockAdminEnterprise.getPermissions.mockResolvedValue({
      success: true,
      data: PERMISSIONS,
    });

    render(<RoleForm />);

    await waitFor(() => {
      // enterprise.permission_categories.content → "Content"
      // The category checkbox wraps a <span> with label text, find by text content
      expect(screen.getByText('Content')).toBeInTheDocument();
      expect(screen.getByText('Users')).toBeInTheDocument();
    });
    // A recognised slug must not fall through to the unknown-category label.
    expect(screen.queryByText('Other permissions')).not.toBeInTheDocument();
  });

  it('shows error toast when permissions fail to load', async () => {
    mockAdminEnterprise.getPermissions.mockRejectedValue(new Error('Network error'));

    render(<RoleForm />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows error toast when name is empty on submit (i18n: "Name is Required")', async () => {
    mockAdminEnterprise.getPermissions.mockResolvedValue({
      success: true,
      data: PERMISSIONS,
    });

    const user = userEvent.setup();
    render(<RoleForm />);

    await waitFor(() => expect(screen.getByRole('textbox', { name: /Role Name/i })).toBeInTheDocument());

    // Click Create Role without typing a name
    // i18n: enterprise.create_role → "Create Role"
    const saveBtn = screen.getByRole('button', { name: /^Create Role$/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
      expect(mockAdminEnterprise.createRole).not.toHaveBeenCalled();
    });
  });

  it('calls createRole with name and selected permissions', async () => {
    mockAdminEnterprise.getPermissions.mockResolvedValue({
      success: true,
      data: PERMISSIONS,
    });
    mockAdminEnterprise.createRole.mockResolvedValue({ success: true });

    const user = userEvent.setup();
    render(<RoleForm />);

    await waitFor(() => expect(screen.getByRole('textbox', { name: /Role Name/i })).toBeInTheDocument());

    await user.type(screen.getByRole('textbox', { name: /Role Name/i }), 'Coordinator');

    // enterprise.permissions.content_blog_manage → "Manage blog content"
    const viewCheck = screen.getByRole('checkbox', { name: /Manage blog content/i });
    await user.click(viewCheck);

    const saveBtn = screen.getByRole('button', { name: /^Create Role$/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(mockAdminEnterprise.createRole).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Coordinator',
          permissions: expect.arrayContaining(['content.blog.manage']),
        })
      );
      expect(mockToast.success).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/test/admin/enterprise/roles');
    });
  });

  it('selects all permissions in a category when category checkbox is toggled', async () => {
    mockAdminEnterprise.getPermissions.mockResolvedValue({
      success: true,
      data: PERMISSIONS,
    });
    mockAdminEnterprise.createRole.mockResolvedValue({ success: true });

    const user = userEvent.setup();
    render(<RoleForm />);

    await waitFor(() => expect(screen.getByText('Content')).toBeInTheDocument());

    // The category Checkbox component wraps a <span> with the label text.
    // The checkbox element itself may be a sibling/ancestor of the span —
    // find all checkboxes and click the one whose accessible name or
    // surrounding text matches "Content" (the category header row).
    // The first checkbox in the DOM is the "Content" category because PERMISSIONS
    // has "content" first. Individual permission checkboxes follow it.
    const allCheckboxes = screen.getAllByRole('checkbox');
    // Category checkboxes: index 0 = Content, index 3 = Users
    // (2 individual content.* checkboxes follow the category one)
    await user.click(allCheckboxes[0]);

    await user.type(screen.getByRole('textbox', { name: /Role Name/i }), 'Manager');
    await user.click(screen.getByRole('button', { name: /^Create Role$/i }));

    await waitFor(() => {
      const payload = mockAdminEnterprise.createRole.mock.calls[0][0];
      expect(payload.permissions).toEqual(
        expect.arrayContaining(['content.blog.manage', 'content.pages.manage'])
      );
    });
  });

  it('navigates back when Cancel is pressed', async () => {
    mockAdminEnterprise.getPermissions.mockResolvedValue({ success: true, data: PERMISSIONS });

    const user = userEvent.setup();
    render(<RoleForm />);

    // i18n: enterprise.cancel → "Cancel"
    await waitFor(() => expect(screen.getByRole('button', { name: /^Cancel$/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /^Cancel$/i }));

    expect(mockNavigate).toHaveBeenCalledWith('/test/admin/enterprise/roles');
  });
});

describe('RoleForm — edit mode (:id param present)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParamId = '7';
  });

  it('loads existing role data and pre-fills the name field', async () => {
    mockAdminEnterprise.getPermissions.mockResolvedValue({ success: true, data: PERMISSIONS });
    mockAdminEnterprise.getRole.mockResolvedValue({
      success: true,
      data: { name: 'Moderator', description: 'Can moderate content', permissions: ['content.blog.manage'] },
    });

    render(<RoleForm />);

    await waitFor(() => {
      const nameInput = screen.getByRole('textbox', { name: /Role Name/i }) as HTMLInputElement;
      expect(nameInput.value).toBe('Moderator');
    });

    // content.blog.manage should be checked
    expect(screen.getByRole('checkbox', { name: /Manage blog content/i })).toBeChecked();
  });

  it('calls updateRole (not createRole) on submit', async () => {
    mockAdminEnterprise.getPermissions.mockResolvedValue({ success: true, data: PERMISSIONS });
    mockAdminEnterprise.getRole.mockResolvedValue({
      success: true,
      data: { name: 'Moderator', description: '', permissions: [] },
    });
    mockAdminEnterprise.updateRole.mockResolvedValue({ success: true });

    const user = userEvent.setup();
    render(<RoleForm />);

    // i18n: enterprise.update_role → "Update Role"
    await waitFor(() => expect(screen.getByRole('button', { name: /^Update Role$/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /^Update Role$/i }));

    await waitFor(() => {
      expect(mockAdminEnterprise.updateRole).toHaveBeenCalledWith(7, expect.any(Object));
      expect(mockAdminEnterprise.createRole).not.toHaveBeenCalled();
    });
  });

  it('shows error toast when update API returns failure', async () => {
    mockAdminEnterprise.getPermissions.mockResolvedValue({ success: true, data: PERMISSIONS });
    mockAdminEnterprise.getRole.mockResolvedValue({
      success: true,
      data: { name: 'Moderator', description: '', permissions: [] },
    });
    mockAdminEnterprise.updateRole.mockResolvedValue({ success: false, error: 'Duplicate name' });

    const user = userEvent.setup();
    render(<RoleForm />);

    await waitFor(() => expect(screen.getByRole('button', { name: /^Update Role$/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /^Update Role$/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });
});
