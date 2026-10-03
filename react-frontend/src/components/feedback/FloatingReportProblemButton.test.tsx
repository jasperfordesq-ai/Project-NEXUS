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
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
}));

// ─── Mock sentry / diagnostics (safe no-ops) ─────────────────────────────────
vi.mock('@/lib/sentry', () => ({
  captureSentryMessage: vi.fn(() => 'evt-123'),
  captureSentryFeedback: vi.fn(),
}));

vi.mock('@/lib/supportDiagnostics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supportDiagnostics')>()),
  getSupportDiagnosticsSnapshot: vi.fn(() => ({ ua: 'test' })),
}));

// ─── Controllable auth state ──────────────────────────────────────────────────
// Use a hoisted ref so the vi.mock factory can close over it while tests mutate it.
const { authState } = vi.hoisted(() => ({
  authState: { isAuthenticated: true as boolean },
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: authState.isAuthenticated ? { id: 1, name: 'Tester' } : null,
      isAuthenticated: authState.isAuthenticated,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useToast: () => mockToast,
  }),
);

// FloatingReportProblemButton imports useAuth from the direct module path
// (@/contexts/AuthContext), not the @/contexts barrel — so it must be mocked
// here too, matching Navbar/MobileDrawer tests. Without this the real,
// throwing useAuth runs (no AuthProvider in the test tree).
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: authState.isAuthenticated }),
}));

// The launcher follows the mobile tab bar's own visibility rule; drive it here
// so the test does not need the router, tenant and notification providers the
// real tab bar reads.
const { tabBarState } = vi.hoisted(() => ({ tabBarState: { visible: true as boolean } }));
vi.mock('@/components/layout/MobileTabBar', () => ({
  useMobileTabBarVisible: () => tabBarState.visible,
}));

// ─── Stub heavy HeroUI overlays + form controls ───────────────────────────────
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    // Modal suite — render the ModalContent render-prop eagerly
    Modal: ({ isOpen, children }: { isOpen: boolean; onClose?: () => void; children?: React.ReactNode }) =>
      isOpen ? <div role="dialog" aria-label="Dialog" aria-modal="true">{children}</div> : null,
    ModalContent: ({ children }: { children: ((onClose: () => void) => React.ReactNode) | React.ReactNode }) => (
      <div>{typeof children === 'function' ? children(() => {}) : children}</div>
    ),
    ModalHeader: ({ children }: { children?: React.ReactNode }) => <div data-testid="modal-header">{children}</div>,
    ModalBody: ({ children, ...rest }: { children?: React.ReactNode; [key: string]: unknown }) => (
      <div data-testid="modal-body" {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>
    ),
    ModalFooter: ({ children, ...rest }: { children?: React.ReactNode; [key: string]: unknown }) => (
      <div data-testid="modal-footer" {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>
    ),
    // Select — render a native <select> for predictable interaction
    Select: ({
      label,
      children,
      onValueChange,
    }: {
      label?: string;
      children?: React.ReactNode;
      onValueChange?: (v: string) => void;
      value?: string;
    }) => (
      <label>
        {label}
        <select
          aria-label={label}
          onChange={(e) => onValueChange?.(e.target.value)}
          data-testid="impact-select"
        >
          {children}
        </select>
      </label>
    ),
    SelectItem: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
      <option value={id}>{children}</option>
    ),
    // Textarea — native textarea
    Textarea: ({
      label,
      onValueChange,
      value,
      minRows: _minRows,
      ...rest
    }: {
      label?: string;
      onValueChange?: (v: string) => void;
      value?: string;
      minRows?: number;
      [key: string]: unknown;
    }) => (
      <label>
        {label}
        <textarea
          aria-label={label as string}
          value={value}
          onChange={(e) => onValueChange?.(e.target.value)}
          data-testid="description-textarea"
          {...(rest as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
        />
      </label>
    ),
    // Input — native input
    Input: ({
      label,
      onValueChange,
      value,
      isRequired: _isRequired,
      ...rest
    }: {
      label?: string;
      onValueChange?: (v: string) => void;
      value?: string;
      isRequired?: boolean;
      [key: string]: unknown;
    }) => (
      <label>
        {label}
        <input
          aria-label={label as string}
          value={value}
          onChange={(e) => onValueChange?.(e.target.value)}
          data-testid="summary-input"
          {...(rest as React.InputHTMLAttributes<HTMLInputElement>)}
        />
      </label>
    ),
    Alert: ({ title, description }: { title?: string; description?: string; color?: string }) => (
      <div data-testid="alert">
        {title} {description}
      </div>
    ),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
function pickSomethingIsNotWorking() {
  fireEvent.click(screen.getByRole('radio', { name: /Something isn't working/ }));
}

// ─────────────────────────────────────────────────────────────────────────────
describe('FloatingReportProblemButton', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authState.isAuthenticated = true;
    tabBarState.visible = true;
    mockApi.post.mockResolvedValue({
      success: true,
      data: { report: { id: 1, reference: 'RPT-001', status: 'open', impact: 'minor', summary: 'Test' } },
    });
  });

  it('renders the floating wrapper with data-testid when authenticated', async () => {
    const { FloatingReportProblemButton } = await import('./FloatingReportProblemButton');
    render(<FloatingReportProblemButton />);
    expect(screen.getByTestId('floating-report-problem')).toBeInTheDocument();
  });

  it('returns null when user is not authenticated', async () => {
    authState.isAuthenticated = false;
    const { FloatingReportProblemButton } = await import('./FloatingReportProblemButton');
    const { container } = render(<FloatingReportProblemButton />);
    expect(container.querySelector('[data-testid="floating-report-problem"]')).toBeNull();
  });

  it('renders the trigger button', async () => {
    const { FloatingReportProblemButton } = await import('./FloatingReportProblemButton');
    render(<FloatingReportProblemButton />);
    const btns = screen.getAllByRole('button');
    expect(btns.length).toBeGreaterThanOrEqual(1);
  });

  it('modal is NOT visible before the trigger is clicked', async () => {
    const { FloatingReportProblemButton } = await import('./FloatingReportProblemButton');
    render(<FloatingReportProblemButton />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the report modal when trigger button is clicked', async () => {
    const { FloatingReportProblemButton } = await import('./FloatingReportProblemButton');
    render(<FloatingReportProblemButton />);

    const [triggerBtn] = screen.getAllByRole('button');
    fireEvent.click(triggerBtn);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('modal contains the summary input and description textarea', async () => {
    const { FloatingReportProblemButton } = await import('./FloatingReportProblemButton');
    render(<FloatingReportProblemButton />);

    fireEvent.click(screen.getAllByRole('button')[0]);
    await waitFor(() => screen.getByRole('dialog'));
    // "Help & support": the fields appear once the member picks what they need.
    pickSomethingIsNotWorking();

    expect(screen.getByTestId('summary-input')).toBeInTheDocument();
    expect(screen.getByTestId('description-textarea')).toBeInTheDocument();
  });

  it('submits the form and calls api.post with trimmed fields', async () => {
    const { FloatingReportProblemButton } = await import('./FloatingReportProblemButton');
    render(<FloatingReportProblemButton />);

    fireEvent.click(screen.getAllByRole('button')[0]);
    await waitFor(() => screen.getByRole('dialog'));
    // "Help & support": the fields appear once the member picks what they need.
    pickSomethingIsNotWorking();

    fireEvent.change(screen.getByTestId('summary-input'), { target: { value: 'Test bug title' } });
    fireEvent.change(screen.getByTestId('description-textarea'), {
      target: { value: 'This is a longer description of the issue.' },
    });

    const form = document.querySelector('form[data-testid="report-problem-form"]') as HTMLFormElement;
    expect(form).toBeTruthy();
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        '/v2/support/reports',
        expect.objectContaining({
          summary: 'Test bug title',
          description: 'This is a longer description of the issue.',
        }),
      );
    });
  });

  it('shows success toast after a successful submission', async () => {
    const { FloatingReportProblemButton } = await import('./FloatingReportProblemButton');
    render(<FloatingReportProblemButton />);

    fireEvent.click(screen.getAllByRole('button')[0]);
    await waitFor(() => screen.getByRole('dialog'));
    // "Help & support": the fields appear once the member picks what they need.
    pickSomethingIsNotWorking();

    fireEvent.change(screen.getByTestId('summary-input'), { target: { value: 'Bug report' } });
    fireEvent.change(screen.getByTestId('description-textarea'), {
      target: { value: 'Detailed description here for testing.' },
    });

    const form = document.querySelector('form[data-testid="report-problem-form"]') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows error toast when api.post returns success:false', async () => {
    mockApi.post.mockResolvedValueOnce({ success: false, error: 'Server error' });

    const { FloatingReportProblemButton } = await import('./FloatingReportProblemButton');
    render(<FloatingReportProblemButton />);

    fireEvent.click(screen.getAllByRole('button')[0]);
    await waitFor(() => screen.getByRole('dialog'));
    // "Help & support": the fields appear once the member picks what they need.
    pickSomethingIsNotWorking();

    fireEvent.change(screen.getByTestId('summary-input'), { target: { value: 'Bug report' } });
    fireEvent.change(screen.getByTestId('description-textarea'), {
      target: { value: 'Detailed description here for testing.' },
    });

    const form = document.querySelector('form[data-testid="report-problem-form"]') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('is announced as "Help & support" at every width (label is sr-only below lg, visible from lg)', async () => {
    const { FloatingReportProblemButton } = await import('./FloatingReportProblemButton');
    render(<FloatingReportProblemButton />);

    const trigger = screen.getByRole('button', { name: 'Help & support' });
    expect(trigger).toHaveAttribute('data-testid', 'floating-report-problem-trigger');
    expect(screen.getByText('Help & support')).toHaveClass('sr-only', 'lg:not-sr-only');
    // A 48px round target on phones, a labelled pill from lg.
    expect(trigger).toHaveClass('h-12', 'w-12', 'rounded-full', 'lg:w-auto');
  });

  it('docks above the mobile tab bar, clearing the mini-player and the home indicator', async () => {
    const { FloatingReportProblemButton } = await import('./FloatingReportProblemButton');
    render(<FloatingReportProblemButton />);

    const wrapper = screen.getByTestId('floating-report-problem');
    expect(wrapper).toHaveAttribute('data-support-launcher');
    expect(wrapper.className).toContain('bottom-[calc(var(--safe-area-bottom)+5.25rem+var(--miniplayer-offset,0rem))]');
    expect(wrapper.className).toContain('lg:bottom-[calc(1.5rem+var(--miniplayer-offset,0rem))]');
    // Shown on small screens. The regression this guards was "hidden md:block":
    // invisible on phones, and behind the tab bar from 768px to 1023px.
    expect(wrapper).not.toHaveClass('hidden');
    expect(wrapper.className).not.toContain('md:block');
  });

  it('keeps out of the way on small screens where the tab bar is hidden (e.g. a message thread)', async () => {
    tabBarState.visible = false;
    const { FloatingReportProblemButton } = await import('./FloatingReportProblemButton');
    render(<FloatingReportProblemButton />);

    expect(screen.getByTestId('floating-report-problem')).toHaveClass('hidden', 'lg:block');
  });
});
