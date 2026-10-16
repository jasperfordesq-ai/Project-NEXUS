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

vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Toast / Auth / Tenant ───────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => mockToast,
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'God Admin', role: 'god' },
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
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// Stub heavy child components unique to this module
vi.mock('./VerificationAuditLog', () => ({
  VerificationAuditLog: () => <div data-testid="verification-audit-log" />,
}));

vi.mock('./VerificationReviewQueue', () => ({
  VerificationReviewQueue: () => <div data-testid="verification-review-queue" />,
}));

vi.mock('./ProviderHealthDashboard', () => ({
  ProviderHealthDashboard: () => <div data-testid="provider-health-dashboard" />,
}));

vi.mock('./RegistrationBreakerCard', () => ({
  RegistrationBreakerCard: () => <div data-testid="registration-breaker-card" />,
}));

vi.mock('../../components', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

// Stub HeroUI components that can loop or fail in jsdom
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    useConfirm: () => vi.fn().mockResolvedValue(true),
    useDisclosure: () => ({
      isOpen: false,
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onOpenChange: vi.fn(),
    }),
    Select: ({ children, label, onSelectionChange, selectedKeys }: {
      children?: React.ReactNode;
      label?: string;
      onSelectionChange?: (keys: Set<string>) => void;
      selectedKeys?: string[];
    }) => (
      <select
        aria-label={label ?? 'select'}
        value={selectedKeys?.[0] ?? ''}
        onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}
      >
        {children}
      </select>
    ),
    SelectItem: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
      <option value={id ?? ''}>{children}</option>
    ),
    Switch: ({ children, isSelected, onValueChange, isDisabled, 'aria-label': ariaLabel }: {
      children?: React.ReactNode;
      isSelected?: boolean;
      onValueChange?: (v: boolean) => void;
      isDisabled?: boolean;
      'aria-label'?: string;
    }) => (
      <label>
        <input
          type="checkbox"
          checked={isSelected ?? false}
          disabled={isDisabled}
          aria-label={ariaLabel}
          onChange={(e) => onValueChange?.(e.target.checked)}
        />
        {children}
      </label>
    ),
    Accordion: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    AccordionItem: ({ children, title }: { children?: React.ReactNode; title?: React.ReactNode }) => (
      <div>
        <div>{title}</div>
        <div>{children}</div>
      </div>
    ),
    Modal: ({ isOpen, children }: { isOpen?: boolean; children?: React.ReactNode }) =>
      isOpen ? <div role="dialog" aria-label="Dialog">{children}</div> : null,
    ModalContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ModalHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ModalBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ModalFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    // The real React Aria Table builds its collection via a hidden render that
    // doesn't materialise statically-mapped rows reliably in jsdom, so plain
    // table elements are stubbed in for deterministic text queries.
    Table: ({ children }: { children?: React.ReactNode }) => <table>{children}</table>,
    TableHeader: ({ children }: { children?: React.ReactNode }) => <thead><tr>{children}</tr></thead>,
    TableColumn: ({ children }: { children?: React.ReactNode }) => <th>{children}</th>,
    TableBody: ({ children }: { children?: React.ReactNode }) => <tbody>{children}</tbody>,
    TableRow: ({ children }: { children?: React.ReactNode }) => <tr>{children}</tr>,
    TableCell: ({ children }: { children?: React.ReactNode }) => <td>{children}</td>,
  };
});

// ─── Fixtures ────────────────────────────────────────────────────────────────
const { makePolicy, makeProviders, makeInviteCodes } = vi.hoisted(() => ({
  makePolicy: (overrides = {}) => ({
    registration_mode: 'open',
    verification_provider: null,
    verification_level: 'none',
    post_verification: 'activate',
    fallback_mode: 'none',
    require_email_verify: true,
    has_policy: true,
    ...overrides,
  }),
  makeProviders: () => [
    {
      slug: 'stripe_identity',
      name: 'Stripe Identity',
      levels: ['document_only'],
      available: true,
      has_credentials: false,
    },
    {
      slug: 'veriff',
      name: 'Veriff',
      levels: ['document_selfie'],
      available: false,
      has_credentials: true,
    },
  ],
  makeInviteCodes: () => ({
    items: [
      {
        id: 1,
        code: 'INVITE-ABC1',
        max_uses: 10,
        uses_count: 3,
        note: 'Beta testers',
        is_active: 1,
        expires_at: null,
        created_at: '2026-01-01T00:00:00Z',
        creator_name: 'Admin',
      },
    ],
    total: 1,
  }),
}));

function setupMocks(policyOverrides = {}) {
  mockApi.get.mockImplementation((url: string) => {
    if (url.includes('/registration-policy')) {
      return Promise.resolve({ success: true, data: makePolicy(policyOverrides) });
    }
    if (url.includes('/identity/providers')) {
      return Promise.resolve({ success: true, data: makeProviders() });
    }
    if (url.includes('/invite-codes')) {
      return Promise.resolve({ success: true, data: makeInviteCodes() });
    }
    return Promise.resolve({ success: true, data: null });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('RegistrationPolicySettings', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupMocks();
  });

  it('shows loading spinner initially', async () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));
    const { RegistrationPolicySettings } = await import('./RegistrationPolicySettings');
    render(<RegistrationPolicySettings />);

    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders registration breaker card after load', async () => {
    const { RegistrationPolicySettings } = await import('./RegistrationPolicySettings');
    render(<RegistrationPolicySettings />);

    await waitFor(() => {
      expect(screen.getByTestId('registration-breaker-card')).toBeInTheDocument();
    });
  });

  it('renders identity provider names in accordion after load', async () => {
    const { RegistrationPolicySettings } = await import('./RegistrationPolicySettings');
    render(<RegistrationPolicySettings />);

    await waitFor(() => {
      expect(screen.getByText('Stripe Identity')).toBeInTheDocument();
      expect(screen.getByText('Veriff')).toBeInTheDocument();
    });
  });

  // A community that brings its own provider keys must register the platform's
  // webhook address in that provider's dashboard, or results never arrive.
  it('shows each provider the webhook address to register, with the provider slug in it', async () => {
    const { RegistrationPolicySettings } = await import('./RegistrationPolicySettings');
    render(<RegistrationPolicySettings />);

    await waitFor(() => {
      expect(screen.getByText('Stripe Identity')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Stripe Identity'));

    await waitFor(() => {
      expect(screen.getByText(/\/v2\/webhooks\/identity\/stripe_identity$/)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/platform's own provider account/i).length).toBeGreaterThan(0);
  });

  it('renders Save Policy button', async () => {
    const { RegistrationPolicySettings } = await import('./RegistrationPolicySettings');
    render(<RegistrationPolicySettings />);

    await waitFor(() => {
      const saveBtn = screen.getAllByRole('button').find(
        (b) => b.textContent?.toLowerCase().includes('save') || b.textContent?.toLowerCase().includes('policy')
      );
      expect(saveBtn).toBeDefined();
    });
  });

  it('calls PUT /v2/admin/config/registration-policy on save', async () => {
    mockApi.put.mockResolvedValue({ success: true, data: makePolicy() });
    const { RegistrationPolicySettings } = await import('./RegistrationPolicySettings');
    render(<RegistrationPolicySettings />);

    await waitFor(() => screen.getByTestId('registration-breaker-card'));

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) {
      fireEvent.click(saveBtn);
      await waitFor(() => {
        expect(mockApi.put).toHaveBeenCalledWith(
          '/v2/admin/config/registration-policy',
          expect.objectContaining({ registration_mode: 'open' })
        );
      });
    }
  });

  it('shows success toast on successful save', async () => {
    mockApi.put.mockResolvedValue({ success: true, data: makePolicy() });
    const { RegistrationPolicySettings } = await import('./RegistrationPolicySettings');
    render(<RegistrationPolicySettings />);

    await waitFor(() => screen.getByTestId('registration-breaker-card'));

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) {
      fireEvent.click(saveBtn);
      await waitFor(() => {
        expect(mockToast.success).toHaveBeenCalled();
      });
    }
  });

  it('shows invite codes section when mode is invite_only', async () => {
    setupMocks({ registration_mode: 'invite_only' });
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/registration-policy')) {
        return Promise.resolve({ success: true, data: makePolicy({ registration_mode: 'invite_only' }) });
      }
      if (url.includes('/identity/providers')) {
        return Promise.resolve({ success: true, data: makeProviders() });
      }
      if (url.includes('/invite-codes')) {
        return Promise.resolve({ success: true, data: makeInviteCodes() });
      }
      return Promise.resolve({ success: true, data: null });
    });

    const { RegistrationPolicySettings } = await import('./RegistrationPolicySettings');
    render(<RegistrationPolicySettings />);

    await waitFor(() => {
      // Invite codes section: shows the code
      expect(screen.getByText('INVITE-ABC1')).toBeInTheDocument();
    });
  });

  it('renders the VerificationAuditLog stub', async () => {
    const { RegistrationPolicySettings } = await import('./RegistrationPolicySettings');
    render(<RegistrationPolicySettings />);

    await waitFor(() => {
      expect(screen.getByTestId('verification-audit-log')).toBeInTheDocument();
    });
  });

  it('renders the VerificationReviewQueue stub', async () => {
    const { RegistrationPolicySettings } = await import('./RegistrationPolicySettings');
    render(<RegistrationPolicySettings />);

    await waitFor(() => {
      expect(screen.getByTestId('verification-review-queue')).toBeInTheDocument();
    });
  });

  it('shows error toast when policy fetch fails', async () => {
    mockApi.get.mockRejectedValue(new Error('network'));
    const { RegistrationPolicySettings } = await import('./RegistrationPolicySettings');
    render(<RegistrationPolicySettings />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });
});
