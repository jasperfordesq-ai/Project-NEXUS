// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ─── Hoisted mocks ───────────────────────────────────────────────────────────
const { mockAdminUsers, mockAdminTimebanking, mockAdminVetting, mockAdminInsurance, mockApi } =
  vi.hoisted(() => ({
    mockAdminUsers: {
      get: vi.fn(),
      update: vi.fn(),
      getConsents: vi.fn(),
      sendVerificationEmail: vi.fn(),
      confirmEmail: vi.fn(),
    },
    mockAdminTimebanking: { adjustBalance: vi.fn() },
    mockAdminVetting: { getUserRecords: vi.fn() },
    mockAdminInsurance: { getUserCertificates: vi.fn() },
    mockApi: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  }));

vi.mock('@/admin/api/adminApi', () => ({
  adminUsers: mockAdminUsers,
  adminTimebanking: mockAdminTimebanking,
  adminVetting: mockAdminVetting,
  adminInsurance: mockAdminInsurance,
  adminCrm: { getFunnel: vi.fn() },
  adminMenus: { list: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Router ──────────────────────────────────────────────────────────────────
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: '42' }),
  };
});

// ─── Contexts ────────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Admin', is_super_admin: true, is_tenant_super_admin: true, is_god: false },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Stub heavy child components ─────────────────────────────────────────────
vi.mock('../../components/PageHeader', () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

// A minimal stand-in that still lets a test confirm the dialog it opened.
const { ConfirmStub } = vi.hoisted(() => ({
  ConfirmStub: ({ isOpen, onConfirm, title, confirmLabel }: {
    isOpen: boolean; onConfirm: () => void; title: string; confirmLabel?: string;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <button type="button" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    ) : null,
}));

vi.mock('../../components/ConfirmModal', () => ({
  default: ConfirmStub,
  ConfirmModal: ConfirmStub,
}));

vi.mock('../../components', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  ConfirmModal: () => null,
  StatCard: ({ label }: { label: string }) => <div>{label}</div>,
  Abbr: ({ children }: { children: React.ReactNode }) => <abbr>{children}</abbr>,
  DataTable: () => <div data-testid="data-table" />,
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeUser = (overrides = {}) => ({
  id: 42,
  first_name: 'Alice',
  last_name: 'Smith',
  email: 'alice@example.com',
  role: 'member',
  status: 'active',
  is_super_admin: false,
  is_tenant_super_admin: false,
  balance: 10,
  xp: 100,
  created_at: '2025-01-01T00:00:00Z',
  last_active_at: '2025-06-01T00:00:00Z',
  avatar_url: null,
  badges: [],
  tenant_id: 2,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('UserEdit', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminUsers.get.mockResolvedValue({ success: true, data: makeUser() });
    mockAdminUsers.update.mockResolvedValue({ success: true, data: makeUser() });
    mockAdminUsers.getConsents.mockResolvedValue({ success: true, data: [] });
    mockAdminUsers.sendVerificationEmail.mockResolvedValue({ success: true, data: { sent: true } });
    mockAdminVetting.getUserRecords.mockResolvedValue({ success: true, data: [] });
    mockAdminInsurance.getUserCertificates.mockResolvedValue({ success: true, data: [] });
  });

  it('shows loading spinner while user data is fetching', async () => {
    mockAdminUsers.get.mockImplementationOnce(() => new Promise(() => {}));
    const { UserEdit } = await import('./UserEdit');
    render(<UserEdit />);

    const statuses = screen.getAllByRole('status');
    const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('loads and displays user name fields', async () => {
    const { UserEdit } = await import('./UserEdit');
    render(<UserEdit />);

    await waitFor(() => {
      const inputs = screen.getAllByRole('textbox');
      const firstNameInput = inputs.find(
        (el) => (el as HTMLInputElement).value === 'Alice' || el.getAttribute('value') === 'Alice'
      );
      expect(firstNameInput).toBeDefined();
    });
  });

  it('calls adminUsers.get with correct id on mount', async () => {
    const { UserEdit } = await import('./UserEdit');
    render(<UserEdit />);

    await waitFor(() => {
      expect(mockAdminUsers.get).toHaveBeenCalledWith(42);
    });
  });

  it('shows error message when user load fails', async () => {
    mockAdminUsers.get.mockRejectedValueOnce(new Error('Not found'));
    const { UserEdit } = await import('./UserEdit');
    render(<UserEdit />);

    await waitFor(() => {
      // Error displayed or toast fired
      const hasErrorText = document.body.textContent?.toLowerCase().includes('error') ||
        document.body.textContent?.toLowerCase().includes('failed') ||
        document.body.textContent?.toLowerCase().includes('not found');
      expect(hasErrorText || mockToast.error.mock.calls.length > 0).toBe(true);
    });
  });

  it('updates a text field value', async () => {
    const { UserEdit } = await import('./UserEdit');
    render(<UserEdit />);

    await waitFor(() => screen.getAllByRole('textbox').length > 0);

    const inputs = screen.getAllByRole('textbox');
    const firstInput = inputs[0];
    fireEvent.change(firstInput, { target: { value: 'Updated' } });
    expect((firstInput as HTMLInputElement).value).toBe('Updated');
  });

  it('calls adminUsers.update on save', async () => {
    const { UserEdit } = await import('./UserEdit');
    render(<UserEdit />);

    await waitFor(() => screen.getAllByRole('button').length > 0);

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    expect(saveBtn).toBeDefined();
    if (saveBtn) {
      await userEvent.click(saveBtn);
      await waitFor(() => {
        expect(mockAdminUsers.update).toHaveBeenCalledWith(42, expect.any(Object));
      });
    }
  });

  it('shows success toast after successful save', async () => {
    const { UserEdit } = await import('./UserEdit');
    render(<UserEdit />);

    await waitFor(() => screen.getAllByRole('button').length > 0);

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) {
      await userEvent.click(saveBtn);
      await waitFor(() => {
        expect(mockToast.success).toHaveBeenCalled();
      });
    }
  });

  it('shows error toast on save failure', async () => {
    mockAdminUsers.update.mockRejectedValueOnce(new Error('Server error'));
    const { UserEdit } = await import('./UserEdit');
    render(<UserEdit />);

    await waitFor(() => screen.getAllByRole('button').length > 0);

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) {
      await userEvent.click(saveBtn);
      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled();
      });
    }
  });

  it('renders user email in the form', async () => {
    const { UserEdit } = await import('./UserEdit');
    render(<UserEdit />);

    await waitFor(() => {
      const inputs = screen.getAllByRole('textbox');
      const emailInput = inputs.find(
        (el) => (el as HTMLInputElement).value === 'alice@example.com' ||
          el.getAttribute('value') === 'alice@example.com' ||
          el.getAttribute('type') === 'email'
      );
      expect(emailInput).toBeDefined();
    });
  });

  it('fetches consents and vetting records on mount', async () => {
    const { UserEdit } = await import('./UserEdit');
    render(<UserEdit />);

    await waitFor(() => {
      expect(mockAdminUsers.getConsents).toHaveBeenCalled();
      expect(mockAdminVetting.getUserRecords).toHaveBeenCalled();
    });
  });

  it('shows resend verification email action for an unverified user', async () => {
    mockAdminUsers.get.mockResolvedValueOnce({
      success: true,
      data: makeUser({ email_verified_at: null }),
    });
    const { UserEdit } = await import('./UserEdit');
    render(<UserEdit />);

    const resendButton = await screen.findByRole('button', { name: /resend verification email/i });
    await userEvent.click(resendButton);

    await waitFor(() => {
      expect(mockAdminUsers.sendVerificationEmail).toHaveBeenCalledWith(42);
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows activated email status instead of resend action for a verified user', async () => {
    mockAdminUsers.get.mockResolvedValueOnce({
      success: true,
      data: makeUser({ email_verified_at: '2026-06-01T10:00:00Z' }),
    });
    const { UserEdit } = await import('./UserEdit');
    render(<UserEdit />);

    await waitFor(() => {
      expect(screen.getByText('Email activated')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /resend verification email/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /mark as confirmed/i })).not.toBeInTheDocument();
    });
  });

  it('lets an admin mark an unverified email as confirmed after confirming the dialog', async () => {
    mockAdminUsers.get
      .mockResolvedValueOnce({ success: true, data: makeUser({ email_verified_at: null }) })
      .mockResolvedValue({ success: true, data: makeUser({ email_verified_at: '2026-10-08T10:00:00Z' }) });
    mockAdminUsers.confirmEmail.mockResolvedValue({ success: true, data: makeUser({ email_verified_at: '2026-10-08T10:00:00Z' }) });
    const { UserEdit } = await import('./UserEdit');
    render(<UserEdit />);

    await userEvent.click(await screen.findByRole('button', { name: /mark as confirmed/i }));
    expect(mockAdminUsers.confirmEmail).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog', { name: /mark this email as confirmed/i });
    await userEvent.click(within(dialog).getByRole('button', { name: /mark as confirmed/i }));

    await waitFor(() => {
      expect(mockAdminUsers.confirmEmail).toHaveBeenCalledWith(42);
      expect(mockToast.success).toHaveBeenCalled();
      expect(screen.getByText('Email activated')).toBeInTheDocument();
    });
  });

  it('reports a failure to mark the email confirmed', async () => {
    mockAdminUsers.get.mockResolvedValue({ success: true, data: makeUser({ email_verified_at: null }) });
    mockAdminUsers.confirmEmail.mockResolvedValue({ success: false, error: 'nope' });
    const { UserEdit } = await import('./UserEdit');
    render(<UserEdit />);

    await userEvent.click(await screen.findByRole('button', { name: /mark as confirmed/i }));
    const dialog = await screen.findByRole('dialog', { name: /mark this email as confirmed/i });
    await userEvent.click(within(dialog).getByRole('button', { name: /mark as confirmed/i }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });
});
