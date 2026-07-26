// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';
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

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (url: string | null) => url ?? '',
  resolveThumbnailUrl: (url: string | null) => url ?? '',
  formatRelativeTime: () => '2 hours ago',
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

// ─── Contexts ────────────────────────────────────────────────────────────────
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
};

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Test User' },
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

// ─── Stub heavy Modal/Tabs so jsdom can handle them ──────────────────────────
// It is ReactionDetailsModal, not ReactionSummary, that imports these from
// '@/components/ui/Modal' and '@/components/ui/Tabs'. Registering the stubs on the barrel alone
// left them dead, so the real HeroUI Modal and Tabs were the ones jsdom had to handle — the exact
// thing this block exists to avoid. Hoisted so the barrel and both direct paths share one
// definition; the stubs are prop-driven, so sharing is safe.
const modalStub = vi.hoisted(() => ({
  Modal: ({ isOpen, children }: { isOpen?: boolean; children?: React.ReactNode }) =>
    isOpen ? <div role="dialog" aria-label="Dialog" data-testid="reactions-modal">{children}</div> : null,
  ModalContent: ({ children }: { children: ((onClose: () => void) => React.ReactNode) | React.ReactNode }) => (
    <div>{typeof children === 'function' ? children(() => {}) : children}</div>
  ),
  ModalHeader: ({ children }: { children?: React.ReactNode }) => <div data-testid="modal-header">{children}</div>,
  // ReactionDetailsModal imports ModalHeading, which the old barrel override never listed — it
  // could get away with that while the override was dead. Vitest throws when a factory omits an
  // export the code accesses, so activating the mock requires it.
  ModalHeading: ({ children }: { children?: React.ReactNode }) => <h2 data-testid="modal-heading">{children}</h2>,
  ModalBody: ({ children }: { children?: React.ReactNode }) => <div data-testid="modal-body">{children}</div>,
}));

// Tabs is deliberately NOT stubbed. ReactionDetailsModal imports it from '@/components/ui/Tabs',
// so the barrel override this file used to carry was dead and the real HeroUI Tabs has always been
// what rendered — which is what the tab assertion below was written against: it queries
// role="tablist" with an accessible name, which a plain <div> stub does not expose. The real Tabs
// works in jsdom here, so the dead override was removed rather than activated.
vi.mock('@/components/ui/Modal', () => modalStub);

vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    ...modalStub,
    Spinner: () => <div role="status" aria-busy="true" />,
    Avatar: ({ name }: { name?: string }) => <div data-testid="avatar" aria-label={name} />,
    Button: ({ children, onPress, onClick, 'aria-label': ariaLabel, isLoading, isDisabled, ...rest }: {
      children?: React.ReactNode;
      onPress?: () => void;
      onClick?: () => void;
      'aria-label'?: string;
      isLoading?: boolean;
      isDisabled?: boolean;
      [key: string]: unknown;
    }) => (
      <button
        aria-label={ariaLabel}
        onClick={onPress ?? onClick}
        disabled={isDisabled}
        {...rest}
      >
        {isLoading ? 'Loading…' : children}
      </button>
    ),
    Chip: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  };
});

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeProps = (overrides = {}) => ({
  counts: { love: 5, laugh: 2 },
  total: 7,
  topReactors: [
    { id: 10, name: 'Alice', avatar_url: null },
    { id: 11, name: 'Bob', avatar_url: null },
  ],
  entityType: 'post',
  entityId: 42,
  ...overrides,
});

describe('ReactionSummary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue({
      success: true,
      data: { counts: { love: 5, laugh: 2 }, total: 7, top_reactors: [] },
    });
  });

  it('renders nothing when total is 0', async () => {
    const { ReactionSummary } = await import('./ReactionSummary');
    render(
      <ReactionSummary counts={{}} total={0} entityType="post" entityId={1} />
    );
    // When total=0 component returns null — no reaction summary button in the DOM
    expect(screen.queryByRole('button', { name: /view reactions/i })).not.toBeInTheDocument();
  });

  it('renders nothing when counts object is empty', async () => {
    const { ReactionSummary } = await import('./ReactionSummary');
    render(
      <ReactionSummary counts={{}} total={0} entityType="post" entityId={1} />
    );
    // Empty counts → sortedTypes empty → component returns null
    expect(screen.queryByRole('button', { name: /view reactions/i })).not.toBeInTheDocument();
  });

  it('renders a button showing reaction summary text', async () => {
    const { ReactionSummary } = await import('./ReactionSummary');
    render(<ReactionSummary {...makeProps()} />);
    // Should show topReactors names
    const btn = screen.getByRole('button', { name: /View reactions/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent(/Alice/);
  });

  it('summary text shows reactor names when topReactors is provided', async () => {
    const { ReactionSummary } = await import('./ReactionSummary');
    render(<ReactionSummary {...makeProps()} />);
    const btn = screen.getByRole('button');
    expect(btn.textContent).toContain('Alice');
    expect(btn.textContent).toContain('Bob');
  });

  it('summary text shows total count when no topReactors', async () => {
    const { ReactionSummary } = await import('./ReactionSummary');
    render(
      <ReactionSummary
        counts={{ love: 3 }}
        total={3}
        topReactors={[]}
        entityType="post"
        entityId={1}
      />
    );
    const btn = screen.getByRole('button');
    expect(btn.textContent).toMatch(/3/);
  });

  it('opens modal when summary button is clicked', async () => {
    const { ReactionSummary } = await import('./ReactionSummary');
    render(<ReactionSummary {...makeProps()} />);
    const btn = screen.getByRole('button', { name: /View reactions/i });
    await userEvent.click(btn);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('calls api.get to load reactors when modal opens', async () => {
    const { ReactionSummary } = await import('./ReactionSummary');
    render(<ReactionSummary {...makeProps()} />);
    await userEvent.click(screen.getByRole('button', { name: /View reactions/i }));

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(
        expect.stringContaining('/v2/reactions/post/42')
      );
    });
  });

  it('shows reactor names in modal after loading', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: {
        counts: { love: 5 },
        total: 5,
        top_reactors: [
          { id: 20, name: 'Carol', avatar_url: null },
          { id: 21, name: 'Dave', avatar_url: null },
        ],
      },
    });

    const { ReactionSummary } = await import('./ReactionSummary');
    render(<ReactionSummary {...makeProps()} />);
    await userEvent.click(screen.getByRole('button', { name: /View reactions/i }));

    await waitFor(() => {
      expect(screen.getByText('Carol')).toBeInTheDocument();
      expect(screen.getByText('Dave')).toBeInTheDocument();
    });
  });

  it('shows loading spinner while reactors are loading', async () => {
    // Never resolves — stays in loading state
    mockApi.get.mockImplementation(() => new Promise(() => {}));

    const { ReactionSummary } = await import('./ReactionSummary');
    render(<ReactionSummary {...makeProps()} />);
    await userEvent.click(screen.getByRole('button', { name: /View reactions/i }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    const spinner = screen.queryAllByRole('status').find(
      (el) => el.getAttribute('aria-busy') === 'true'
    );
    expect(spinner).toBeDefined();
  });

  it('shows reaction emoji badges in the summary button', async () => {
    const { ReactionSummary } = await import('./ReactionSummary');
    render(
      <ReactionSummary
        counts={{ love: 5, laugh: 2 }}
        total={7}
        topReactors={[]}
        entityType="post"
        entityId={42}
      />
    );
    // The summary button renders emoji spans with role=img
    const imgs = screen.getAllByRole('img');
    const labels = imgs.map((i) => i.getAttribute('aria-label'));
    // Should have 'love' or 'laugh' reaction label
    expect(labels.some((l) => l && /love|laugh/i.test(l))).toBe(true);
  });

  it('shows tabs for each reaction type in modal', async () => {
    const { ReactionSummary } = await import('./ReactionSummary');
    render(
      <ReactionSummary
        counts={{ love: 5, laugh: 2 }}
        total={7}
        topReactors={[]}
        entityType="post"
        entityId={42}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /View reactions/i }));

    expect(await screen.findByRole('tablist', { name: /reaction/i })).toBeInTheDocument();
  });
});
