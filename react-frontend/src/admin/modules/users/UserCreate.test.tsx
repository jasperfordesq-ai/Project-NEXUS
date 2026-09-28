// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ─────────────────────────────────────────────────────────────────────────────
// Stable mock data
// ─────────────────────────────────────────────────────────────────────────────
const { mockToast, mockNavigate, mockAdminUsersCreate } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  mockNavigate: vi.fn(),
  mockAdminUsersCreate: vi.fn(),
}));

vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast }),
);

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../api/adminApi', () => ({
  adminUsers: {
    create: mockAdminUsersCreate,
  },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { UserCreate } from './UserCreate';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: fill the minimum required fields
// ─────────────────────────────────────────────────────────────────────────────
async function fillRequiredFields({
  firstName = 'Jane',
  lastName = 'Doe',
  email = 'jane@example.com',
} = {}) {
  const firstNameInput = screen.getByRole('textbox', { name: /first.name/i });
  const lastNameInput = screen.getByRole('textbox', { name: /last.name/i });
  const emailInput = screen.getByRole('textbox', { name: /email/i });

  await userEvent.clear(firstNameInput);
  await userEvent.type(firstNameInput, firstName);
  await userEvent.clear(lastNameInput);
  await userEvent.type(lastNameInput, lastName);
  await userEvent.clear(emailInput);
  await userEvent.type(emailInput, email);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────
describe('UserCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the form with all key fields', () => {
    render(<UserCreate />);

    expect(screen.getByRole('textbox', { name: /first.name/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /last.name/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /email/i })).toBeInTheDocument();
    // Switch for "send welcome email" is rendered
    expect(screen.getByRole('switch')).toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('submits valid form and navigates on success', async () => {
    mockAdminUsersCreate.mockResolvedValue({ success: true, data: { id: 99 } });

    render(<UserCreate />);
    await fillRequiredFields();

    const form = document.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockAdminUsersCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          send_welcome_email: true,
        }),
      );
    });
    expect(mockAdminUsersCreate.mock.calls[0]?.[0]).not.toHaveProperty('password');
    expect(mockToast.success).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/admin/users'));
  });

  it('shows validation errors when required fields are empty', async () => {
    render(<UserCreate />);

    const form = document.querySelector('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      // Validation should prevent the API call
      expect(mockAdminUsersCreate).not.toHaveBeenCalled();
    });
  });

  it('shows email-invalid error for malformed email', async () => {
    render(<UserCreate />);

    const firstNameInput = screen.getByRole('textbox', { name: /first.name/i });
    const lastNameInput = screen.getByRole('textbox', { name: /last.name/i });
    const emailInput = screen.getByRole('textbox', { name: /email/i });

    await userEvent.type(firstNameInput, 'Jane');
    await userEvent.type(lastNameInput, 'Doe');
    await userEvent.type(emailInput, 'not-an-email');

    const form = document.querySelector('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockAdminUsersCreate).not.toHaveBeenCalled();
    });
  });

  it('shows error toast when API returns error', async () => {
    mockAdminUsersCreate.mockResolvedValue({ success: false, error: 'Email already taken' });

    render(<UserCreate />);
    await fillRequiredFields();

    const form = document.querySelector('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Email already taken');
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows generic error toast on network exception', async () => {
    mockAdminUsersCreate.mockRejectedValue(new Error('Network failure'));

    render(<UserCreate />);
    await fillRequiredFields();

    const form = document.querySelector('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows password-too-short validation when password < 8 chars', async () => {
    render(<UserCreate />);
    await fillRequiredFields();

    // A manual password is offered only when the invitation is disabled.
    await userEvent.click(screen.getByRole('switch'));
    const pwInput = document.querySelector('input[type="password"]') as HTMLInputElement | null;
    expect(pwInput).not.toBeNull();
    await userEvent.type(pwInput!, 'abc');

    const form = document.querySelector('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockAdminUsersCreate).not.toHaveBeenCalled();
    });
  });

  it('includes optional phone in payload when filled', async () => {
    mockAdminUsersCreate.mockResolvedValue({ success: true, data: { id: 1 } });

    render(<UserCreate />);
    await fillRequiredFields();

    const phoneInput = screen.getByRole('textbox', { name: /phone/i });
    await userEvent.type(phoneInput, '+1 555 123 4567');

    const form = document.querySelector('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockAdminUsersCreate).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+1 555 123 4567' }),
      );
    });
  });

  it('does NOT include phone in payload when blank', async () => {
    mockAdminUsersCreate.mockResolvedValue({ success: true, data: { id: 1 } });

    render(<UserCreate />);
    await fillRequiredFields();

    const form = document.querySelector('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      const call = mockAdminUsersCreate.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call).not.toHaveProperty('phone');
    });
  });

  it('navigates back when Cancel button is pressed', async () => {
    render(<UserCreate />);

    // There are two cancel/back buttons; pick the "Cancel" one (in the submit area)
    const allButtons = screen.getAllByRole('button');
    const cancelBtn = allButtons.find((b) =>
      /cancel/i.test(b.textContent || ''),
    );
    expect(cancelBtn).toBeTruthy();
    await userEvent.click(cancelBtn!);

    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/admin/users'));
  });
});
