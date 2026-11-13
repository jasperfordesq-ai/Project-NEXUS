// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── Stable hoisted mock data ──────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));
const mockNavigate = vi.hoisted(() => vi.fn());
const mockCreateApiKey = vi.hoisted(() => vi.fn());

// ── Module mocks ──────────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  }),
);

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../api/adminApi', () => ({
  adminFederation: {
    createApiKey: mockCreateApiKey,
  },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

// PartnerTimebankGuidance renders accordions with translated keys — mock it to
// keep tests focused on the form logic.
vi.mock('./PartnerTimebankGuidance', () => ({
  PartnerTimebankGuidance: () => <div data-testid="partner-guidance" />,
}));

import { CreateApiKey } from './CreateApiKey';

describe('CreateApiKey — form view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Initial render ────────────────────────────────────────────────────────
  it('renders the key name label', () => {
    render(<CreateApiKey />);
    // real en translation: "Key name"
    expect(screen.getByText('Key name')).toBeInTheDocument();
  });

  it('renders scope checkboxes', () => {
    render(<CreateApiKey />);
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0);
  });

  it('renders the Create Key button disabled when name is empty', () => {
    render(<CreateApiKey />);

    // real en translation: "Create key"
    const createBtn = screen.getByRole('button', { name: /^create key$/i });
    expect(
      createBtn.getAttribute('data-disabled') === 'true' ||
      createBtn.getAttribute('aria-disabled') === 'true' ||
      (createBtn as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('renders the Cancel button', () => {
    render(<CreateApiKey />);
    // real en translation: "Cancel"
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
  });

  it('renders the Back button', () => {
    render(<CreateApiKey />);
    // real en translation for federation.back: "Back"
    expect(screen.getByRole('button', { name: /^back$/i })).toBeInTheDocument();
  });

  it('shows the PartnerTimebankGuidance component', () => {
    render(<CreateApiKey />);
    expect(screen.getByTestId('partner-guidance')).toBeInTheDocument();
  });

  // ── Scope toggle ──────────────────────────────────────────────────────────
  it('toggles a scope checkbox on click', async () => {
    render(<CreateApiKey />);

    const checkboxes = screen.getAllByRole('checkbox');
    const first = checkboxes[0];
    // Initially unchecked
    const isInitiallyChecked =
      first.getAttribute('aria-checked') === 'true' || (first as HTMLInputElement).checked;
    expect(isInitiallyChecked).toBe(false);

    await userEvent.click(first);

    await waitFor(() => {
      expect(
        first.getAttribute('aria-checked') === 'true' || (first as HTMLInputElement).checked,
      ).toBe(true);
    });
  });

  // ── Successful key creation (api_key in response) ─────────────────────────
  it('shows the created key in the success view', async () => {
    mockCreateApiKey.mockResolvedValue({
      success: true,
      data: { api_key: 'nexus_test_secret_key_abc123' },
    });
    render(<CreateApiKey />);

    // real en label: "Key name"
    const nameInput = screen.getByRole('textbox', { name: /^key name$/i });
    await userEvent.type(nameInput, 'My Partner Key');

    const createBtn = screen.getByRole('button', { name: /^create key$/i });
    await userEvent.click(createBtn);

    await waitFor(() => {
      expect(screen.getByText('nexus_test_secret_key_abc123')).toBeInTheDocument();
    });
    // real en: "Your new API key"
    expect(screen.getByText('Your new API key')).toBeInTheDocument();
  });

  it('calls adminFederation.createApiKey with correct name payload', async () => {
    mockCreateApiKey.mockResolvedValue({
      success: true,
      data: { api_key: 'nexus_key_xyz' },
    });
    render(<CreateApiKey />);

    const nameInput = screen.getByRole('textbox', { name: /^key name$/i });
    await userEvent.type(nameInput, 'Test Key Name');

    const createBtn = screen.getByRole('button', { name: /^create key$/i });
    await userEvent.click(createBtn);

    await waitFor(() => {
      expect(mockCreateApiKey).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Test Key Name' }),
      );
    });
  });

  // ── Navigation after no api_key in response ───────────────────────────────
  it('navigates to api-keys list when response has no api_key field', async () => {
    mockCreateApiKey.mockResolvedValue({
      success: true,
      data: { id: 5, key: 'prefix_only', name: 'Key' },
    });
    render(<CreateApiKey />);

    const nameInput = screen.getByRole('textbox', { name: /^key name$/i });
    await userEvent.type(nameInput, 'Navigate Key');

    const createBtn = screen.getByRole('button', { name: /^create key$/i });
    await userEvent.click(createBtn);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    });
  });

  // ── API error ─────────────────────────────────────────────────────────────
  it('shows error toast when createApiKey throws', async () => {
    mockCreateApiKey.mockRejectedValue(new Error('Server error'));
    render(<CreateApiKey />);

    const nameInput = screen.getByRole('textbox', { name: /^key name$/i });
    fireEvent.change(nameInput, { target: { value: 'Error Key' } });

    // Need to also update internal React state properly for the isDisabled check
    await userEvent.type(nameInput, 'x');

    const createBtn = screen.getByRole('button', { name: /^create key$/i });
    await userEvent.click(createBtn);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  // ── Cancel navigation ──────────────────────────────────────────────────────
  it('navigates when cancel button is clicked', async () => {
    render(<CreateApiKey />);

    const cancelBtn = screen.getByRole('button', { name: /^cancel$/i });
    await userEvent.click(cancelBtn);

    expect(mockNavigate).toHaveBeenCalled();
  });
});

describe('CreateApiKey — success view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderWithCreatedKey = async () => {
    mockCreateApiKey.mockResolvedValue({
      success: true,
      data: { api_key: 'secret_key_show_once' },
    });
    render(<CreateApiKey />);

    const nameInput = screen.getByRole('textbox', { name: /^key name$/i });
    await userEvent.type(nameInput, 'My Key');

    const createBtn = screen.getByRole('button', { name: /^create key$/i });
    await userEvent.click(createBtn);

    await waitFor(() => {
      expect(screen.getByText('secret_key_show_once')).toBeInTheDocument();
    });
  };

  it('shows Copy Key and Done buttons in success view', async () => {
    await renderWithCreatedKey();

    // real en translations: "Copy key", "Done"
    expect(screen.getByRole('button', { name: /copy key/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^done$/i })).toBeInTheDocument();
  });

  it('navigates to api-keys list when Done is clicked', async () => {
    await renderWithCreatedKey();

    const doneBtn = screen.getByRole('button', { name: /^done$/i });
    await userEvent.click(doneBtn);

    expect(mockNavigate).toHaveBeenCalled();
  });

  // navigator.clipboard is not available in jsdom; the Copy Key button calls
  // navigator.clipboard.writeText synchronously — cannot be tested without
  // a clipboard mock. The button rendering and the Copied! state change are
  // omitted here as they require test infrastructure beyond jsdom's scope.
});
