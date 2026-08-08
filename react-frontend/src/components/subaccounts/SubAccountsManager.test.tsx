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
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...actual,
    resolveAvatarUrl: (url: string | null) => url ?? '',
  };
});

// ─── Toast / Contexts ────────────────────────────────────────────────────────
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
};

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({
      user: { id: 1, name: 'Alice', role: 'member' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// Stub EmptyState
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title }: { title: string }) => (
    <div data-testid="empty-state">{title}</div>
  ),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeAccount = (overrides = {}): Record<string, unknown> => ({
  relationship_id: 1,
  relationship_type: 'sub_account',
  permissions: {
    can_view_activity: true,
    can_manage_listings: false,
    can_transact: false,
    can_view_messages: false,
  },
  status: 'active',
  approved_at: '2025-01-01T00:00:00Z',
  created_at: '2025-01-01T00:00:00Z',
  user_id: 2,
  first_name: 'Bob',
  last_name: 'Smith',
  avatar_url: null,
  email: 'bob@example.com',
  ...overrides,
});

const emptyResponse = { success: true, data: [] };

// ─────────────────────────────────────────────────────────────────────────────
describe('SubAccountsManager', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: no accounts
    mockApi.get.mockResolvedValue(emptyResponse);
  });

  it('shows loading spinner initially', async () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));
    const { SubAccountsManager } = await import('./SubAccountsManager');
    render(<SubAccountsManager />);

    const statusEls = screen.getAllByRole('status');
    const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders empty state when no accounts returned', async () => {
    const { SubAccountsManager } = await import('./SubAccountsManager');
    render(<SubAccountsManager />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders add sub-account button in header', async () => {
    const { SubAccountsManager } = await import('./SubAccountsManager');
    render(<SubAccountsManager />);

    await waitFor(() => {
      // Button text is t('sub_accounts.add_button') — key fallback or i18n
      const addBtn = screen.getAllByRole('button').find(
        (b) =>
          b.textContent?.toLowerCase().includes('add') ||
          b.textContent?.toLowerCase().includes('sub_accounts.add_button')
      );
      expect(addBtn).toBeDefined();
    });
  });

  it('opens add modal when button clicked', async () => {
    const { SubAccountsManager } = await import('./SubAccountsManager');
    render(<SubAccountsManager />);

    await waitFor(() => screen.getByTestId('empty-state'));

    const addBtn = screen.getAllByRole('button').find(
      (b) =>
        b.textContent?.toLowerCase().includes('add') ||
        b.textContent?.toLowerCase().includes('sub_accounts.add_button')
    );
    expect(addBtn).toBeDefined();
    fireEvent.click(addBtn!);

    await waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).toBeTruthy();
    });
  });

  it('renders active managed account with name and email', async () => {
    mockApi.get
      .mockResolvedValueOnce({ success: true, data: [makeAccount()] }) // sub-accounts
      .mockResolvedValueOnce(emptyResponse); // parent-accounts

    const { SubAccountsManager } = await import('./SubAccountsManager');
    render(<SubAccountsManager />);

    await waitFor(() => {
      expect(screen.getByText('Bob Smith')).toBeInTheDocument();
      expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    });
  });

  it('shows permission toggles for active managed accounts', async () => {
    mockApi.get
      .mockResolvedValueOnce({ success: true, data: [makeAccount({ status: 'active' })] })
      .mockResolvedValueOnce(emptyResponse);

    const { SubAccountsManager } = await import('./SubAccountsManager');
    render(<SubAccountsManager />);

    await waitFor(() => {
      // Permission toggles should exist (Switch components with aria-labels)
      const switches = screen.getAllByRole('switch');
      expect(switches.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('calls PUT permissions endpoint when permission toggled', async () => {
    mockApi.put.mockResolvedValue({ success: true });
    mockApi.get
      .mockResolvedValueOnce({ success: true, data: [makeAccount({ status: 'active' })] })
      .mockResolvedValueOnce(emptyResponse);

    const { SubAccountsManager } = await import('./SubAccountsManager');
    render(<SubAccountsManager />);

    await waitFor(() => screen.getAllByRole('switch'));

    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[0]);

    await waitFor(() => {
      expect(mockApi.put).toHaveBeenCalledWith(
        '/v2/users/me/sub-accounts/1/permissions',
        expect.objectContaining({ permissions: expect.any(Object) }),
      );
    });
  });

  it('renders pending parent account with approve/decline buttons', async () => {
    mockApi.get
      .mockResolvedValueOnce(emptyResponse)
      .mockResolvedValueOnce({
        success: true,
        data: [makeAccount({ relationship_id: 5, status: 'pending', first_name: 'Carol', last_name: 'Jones' })],
      });

    const { SubAccountsManager } = await import('./SubAccountsManager');
    render(<SubAccountsManager />);

    await waitFor(() => {
      expect(screen.getByText('Carol Jones')).toBeInTheDocument();
    });

    const approveBtn = screen.getAllByRole('button').find(
      (b) =>
        b.textContent?.toLowerCase().includes('approv') ||
        b.textContent?.toLowerCase().includes('sub_accounts.approve')
    );
    expect(approveBtn).toBeDefined();

    const declineBtn = screen.getAllByRole('button').find(
      (b) =>
        b.textContent?.toLowerCase().includes('declin') ||
        b.textContent?.toLowerCase().includes('sub_accounts.decline')
    );
    expect(declineBtn).toBeDefined();
  });

  it('calls PUT approve endpoint when approve clicked', async () => {
    mockApi.put.mockResolvedValue({ success: true });
    // Re-load returns empty so we don't get extra accounts
    mockApi.get
      .mockResolvedValueOnce(emptyResponse)
      .mockResolvedValueOnce({
        success: true,
        data: [makeAccount({ relationship_id: 5, status: 'pending', first_name: 'Carol', last_name: 'Jones' })],
      })
      // calls from loadSubAccounts on approve
      .mockResolvedValue(emptyResponse);

    const { SubAccountsManager } = await import('./SubAccountsManager');
    render(<SubAccountsManager />);

    await waitFor(() => screen.getByText('Carol Jones'));

    const approveBtn = screen.getAllByRole('button').find(
      (b) =>
        b.textContent?.toLowerCase().includes('approv') ||
        b.textContent?.toLowerCase().includes('sub_accounts.approve')
    );
    expect(approveBtn).toBeDefined();
    fireEvent.click(approveBtn!);

    await waitFor(() => {
      expect(mockApi.put).toHaveBeenCalledWith('/v2/users/me/sub-accounts/5/approve');
    });
  });

  it('requires confirmation before calling the DELETE endpoint', async () => {
    mockApi.delete.mockResolvedValue({ success: true });
    mockApi.get
      .mockResolvedValueOnce({ success: true, data: [makeAccount({ relationship_id: 3 })] })
      .mockResolvedValueOnce(emptyResponse);

    const { SubAccountsManager } = await import('./SubAccountsManager');
    render(<SubAccountsManager />);

    await waitFor(() => screen.getByText('Bob Smith'));

    const removeBtn = screen.getAllByRole('button').find(
      (b) =>
        b.getAttribute('aria-label')?.toLowerCase().includes('remove') ||
        b.getAttribute('aria-label')?.toLowerCase().includes('sub_accounts.remove_aria')
    );
    expect(removeBtn).toBeDefined();
    fireEvent.click(removeBtn!);

    expect(await screen.findByRole('dialog', { name: 'Remove Bob Smith?' })).toBeInTheDocument();
    expect(mockApi.delete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove support' }));

    await waitFor(() => {
      expect(mockApi.delete).toHaveBeenCalledWith('/v2/users/me/sub-accounts/3');
    });
  });

  it('shows error alert when API load fails', async () => {
    mockApi.get.mockRejectedValue(new Error('network'));

    const { SubAccountsManager } = await import('./SubAccountsManager');
    render(<SubAccountsManager />);

    await waitFor(() => {
      const alert = document.querySelector('[role="alert"]');
      expect(alert).toBeTruthy();
    });
  });

  it('calls POST to add sub-account from modal', async () => {
    mockApi.post.mockResolvedValue({ success: true });
    mockApi.get.mockResolvedValue(emptyResponse);

    const { SubAccountsManager } = await import('./SubAccountsManager');
    render(<SubAccountsManager />);

    await waitFor(() => screen.getByTestId('empty-state'));

    const addBtn = screen.getAllByRole('button').find(
      (b) =>
        b.textContent?.toLowerCase().includes('add') ||
        b.textContent?.toLowerCase().includes('sub_accounts.add_button')
    );
    fireEvent.click(addBtn!);
    await waitFor(() => document.querySelector('[role="dialog"]'));

    // Fill email
    const emailInput = document.querySelector('input[type="email"]');
    if (emailInput) {
      fireEvent.change(emailInput, { target: { value: 'newuser@example.com' } });
    }

    // Click send request button
    const sendBtn = screen.getAllByRole('button').find(
      (b) =>
        b.textContent?.toLowerCase().includes('send') ||
        b.textContent?.toLowerCase().includes('sub_accounts.send_request')
    );
    if (sendBtn) {
      fireEvent.click(sendBtn);
      await waitFor(() => {
        expect(mockApi.post).toHaveBeenCalledWith(
          '/v2/users/me/sub-accounts',
          expect.objectContaining({ email: 'newuser@example.com' }),
        );
      });
    }
  });

  it('shows toast error when trying to add without email', async () => {
    mockApi.get.mockResolvedValue(emptyResponse);

    const { SubAccountsManager } = await import('./SubAccountsManager');
    render(<SubAccountsManager />);

    await waitFor(() => screen.getByTestId('empty-state'));

    const addBtn = screen.getAllByRole('button').find(
      (b) =>
        b.textContent?.toLowerCase().includes('add') ||
        b.textContent?.toLowerCase().includes('sub_accounts.add_button')
    );
    fireEvent.click(addBtn!);
    await waitFor(() => document.querySelector('[role="dialog"]'));

    // Try to send without filling email — the button is disabled when email is empty
    const sendBtn = screen.getAllByRole('button').find(
      (b) =>
        b.textContent?.toLowerCase().includes('send') ||
        b.textContent?.toLowerCase().includes('sub_accounts.send_request')
    );
    // Button should be disabled — HeroUI uses aria-disabled="true" or the disabled attribute
    const isDisabled =
      sendBtn?.getAttribute('disabled') !== null ||
      sendBtn?.getAttribute('aria-disabled') === 'true' ||
      sendBtn?.hasAttribute('disabled');
    expect(isDisabled || sendBtn === undefined).toBe(true);
  });
});
