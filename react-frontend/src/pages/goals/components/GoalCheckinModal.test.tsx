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
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), download: vi.fn(), upload: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({ ...(await importOriginal()), formatRelativeTime: (d: string) => d }));

// ─── Toast / Auth / Tenant ───────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({ user: { id: 1, name: 'Tester' }, isAuthenticated: true, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle' as const, error: null }),
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

// ─── Stub HeroUI Modal render-prop correctly ──────────────────────────────────
// GoalCheckinModal imports its Modal parts from '@/components/ui/Modal', not from the barrel, so
// these stubs only take effect when registered on that specifier — vitest resolves mocks per
// specifier. Hoisted so the barrel factory below reuses them. ModalHeading is included here even
// though the barrel factory never listed it: the component imports it, and vitest 3 throws when a
// factory omits an export the code accesses.
const modalStub = vi.hoisted(() => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div role="dialog" aria-label="Dialog" aria-modal="true">{children}</div> : null,
  ModalContent: ({ children }: { children: React.ReactNode | ((close: () => void) => React.ReactNode) }) =>
    <div>{typeof children === 'function' ? children(() => {}) : children}</div>,
  ModalHeader: ({ children }: { children: React.ReactNode }) => <div data-testid="modal-header">{children}</div>,
  ModalHeading: ({ children }: { children: React.ReactNode }) => <h2 data-testid="modal-heading">{children}</h2>,
  ModalBody: ({ children }: { children: React.ReactNode }) => <div data-testid="modal-body">{children}</div>,
  ModalFooter: ({ children }: { children: React.ReactNode }) => <div data-testid="modal-footer">{children}</div>,
}));

vi.mock('@/components/ui/Modal', () => modalStub);

vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    ...modalStub,
    Button: ({ children, onPress, isLoading, isDisabled, startContent, variant, color, size, isIconOnly, ...rest }: {
      children?: React.ReactNode; onPress?: () => void; isLoading?: boolean; isDisabled?: boolean;
      startContent?: React.ReactNode; variant?: string; color?: string; size?: string; isIconOnly?: boolean; [key: string]: unknown
    }) => (
      <button onClick={onPress} disabled={isDisabled || isLoading}>{startContent}{isLoading ? 'Loading...' : children}</button>
    ),
    Slider: ({ 'aria-label': ariaLabel }: { 'aria-label'?: string }) => <div data-testid="slider" aria-label={ariaLabel} />,
    Separator: () => <hr />,
    Textarea: ({ label, value, onChange, placeholder }: { label?: string; value?: string; onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void; placeholder?: string }) => (
      <div>
        {label && <label>{label}</label>}
        <textarea value={value} onChange={onChange} placeholder={placeholder} />
      </div>
    ),
    Chip: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    Spinner: () => <div role="status" aria-busy="true" />,
    GlassCard: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  };
});

// ─── Stub motion ─────────────────────────────────────────────────────────────
vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, initial, animate, transition, ...rest }: {
      children: React.ReactNode; initial?: unknown; animate?: unknown; transition?: unknown; [key: string]: unknown
    }) => <div {...(rest as object)}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  goalId: 5,
  goalTitle: 'Run a marathon',
  currentProgress: 40,
  onCheckinCreated: vi.fn(),
};

const makeCheckin = (overrides = {}) => ({
  id: 1,
  goal_id: 5,
  progress_percent: 50,
  progress_value: null,
  note: 'Feeling good!',
  mood: 'good',
  created_at: '2025-06-01T10:00:00Z',
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GoalCheckinModal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: [] });
    mockApi.post.mockResolvedValue({ success: true });
  });

  it('renders nothing when isOpen is false', async () => {
    const { GoalCheckinModal } = await import('./GoalCheckinModal');
    render(<GoalCheckinModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders dialog with goal title when open', async () => {
    const { GoalCheckinModal } = await import('./GoalCheckinModal');
    render(<GoalCheckinModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Run a marathon')).toBeInTheDocument();
  });

  it('shows New Check-in and History buttons', async () => {
    const { GoalCheckinModal } = await import('./GoalCheckinModal');
    render(<GoalCheckinModal {...defaultProps} />);
    const buttons = screen.getAllByRole('button');
    const buttonTexts = buttons.map((b) => b.textContent?.toLowerCase() || '');
    expect(buttonTexts.some((t) => t.includes('new') || t.includes('check'))).toBe(true);
    expect(buttonTexts.some((t) => t.includes('history'))).toBe(true);
  });

  it('shows the progress slider on the new check-in tab', async () => {
    // GoalCheckinModal imports Slider from '@/components/ui/Slider', so the
    // '@/components/ui' barrel stub below never applied and its
    // data-testid="slider" never existed. The REAL HeroUI v3 Slider (React
    // Aria) renders role="group" (aria-label from the `aria-label` prop)
    // wrapping a visually-hidden <input type="range"> — implicit role="slider",
    // named via aria-labelledby -> the group, current value on aria-valuetext.
    const { GoalCheckinModal } = await import('./GoalCheckinModal');
    render(<GoalCheckinModal {...defaultProps} />);

    const slider = screen.getByRole('slider', { name: 'Progress percentage' });
    expect(slider).toHaveAttribute('type', 'range');
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '100');
    expect(slider).toHaveAttribute('step', '5');
    // Seeded from the goal's currentProgress (40) and mirrored in the readout.
    expect(slider).toHaveAttribute('aria-valuetext', '40');
    expect(screen.getByText('40%')).toBeInTheDocument();

    // It belongs to the New Check-in tab: switching to History removes it.
    const historyBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('history'));
    if (!historyBtn) throw new Error('History tab button not rendered');
    fireEvent.click(historyBtn);
    await waitFor(() => {
      expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    });
  });

  it('shows Cancel and Submit buttons in the footer', async () => {
    const { GoalCheckinModal } = await import('./GoalCheckinModal');
    render(<GoalCheckinModal {...defaultProps} />);
    const footerButtons = screen.getAllByRole('button');
    const buttonTexts = footerButtons.map((b) => b.textContent?.toLowerCase() || '');
    expect(buttonTexts.some((t) => t.includes('cancel'))).toBe(true);
    expect(buttonTexts.some((t) => t.includes('submit') || t.includes('record') || t.includes('save'))).toBe(true);
  });

  it('calls onClose when Cancel is clicked', async () => {
    const onClose = vi.fn();
    const { GoalCheckinModal } = await import('./GoalCheckinModal');
    render(<GoalCheckinModal {...defaultProps} onClose={onClose} />);
    const cancelBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('cancel'));
    if (cancelBtn) fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('POSTs to the correct checkin endpoint on submit', async () => {
    const { GoalCheckinModal } = await import('./GoalCheckinModal');
    render(<GoalCheckinModal {...defaultProps} />);
    const submitBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('submit') || b.textContent?.toLowerCase().includes('record') || b.textContent?.toLowerCase().includes('save')
    );
    if (submitBtn) fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/goals/5/checkins', expect.any(Object));
    });
  });

  it('shows success toast after successful submission', async () => {
    const { GoalCheckinModal } = await import('./GoalCheckinModal');
    render(<GoalCheckinModal {...defaultProps} />);
    const submitBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('submit') || b.textContent?.toLowerCase().includes('record') || b.textContent?.toLowerCase().includes('save')
    );
    if (submitBtn) fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows error toast when submission fails', async () => {
    mockApi.post.mockResolvedValue({ success: false, error: 'Bad request' });
    const { GoalCheckinModal } = await import('./GoalCheckinModal');
    render(<GoalCheckinModal {...defaultProps} />);
    const submitBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('submit') || b.textContent?.toLowerCase().includes('record') || b.textContent?.toLowerCase().includes('save')
    );
    if (submitBtn) fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('switches to history view and fetches checkins', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: [makeCheckin()] });
    const { GoalCheckinModal } = await import('./GoalCheckinModal');
    render(<GoalCheckinModal {...defaultProps} />);

    const historyBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('history'));
    if (historyBtn) fireEvent.click(historyBtn);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/goals/5/checkins');
    });
  });

  it('shows empty state message when no checkins exist in history', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: [] });
    const { GoalCheckinModal } = await import('./GoalCheckinModal');
    render(<GoalCheckinModal {...defaultProps} />);

    const historyBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('history'));
    if (!historyBtn) throw new Error('History tab button not rendered');
    fireEvent.click(historyBtn);

    await waitFor(() => {
      // Real empty-state copy from public/locales/en/goals.json (checkin.no_checkins),
      // which i18next serves in tests. The old assertion only re-checked that the
      // dialog was still mounted — it could not fail if the empty state regressed.
      expect(screen.getByText('No check-ins yet. Record your first one!')).toBeInTheDocument();
    });
    // ...and it is the empty state, not the load-failure state.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an error + retry (not the empty state) when history load returns success:false', async () => {
    // Regression: loadCheckins gated on `if (response.success && response.data)` with
    // no else, and the catch only fires on a thrown error. A { success:false } (4xx,
    // which api.get resolves without throwing) used to fall through to the
    // "no check-ins yet" empty state — a load failure looked like a goal with no
    // check-ins. It must now reach a distinct error state with a retry control.
    mockApi.get.mockResolvedValue({ success: false, error: 'Cannot load' });
    const { GoalCheckinModal } = await import('./GoalCheckinModal');
    render(<GoalCheckinModal {...defaultProps} />);

    const historyBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('history'));
    if (historyBtn) fireEvent.click(historyBtn);

    await waitFor(() => {
      expect(document.querySelector('[role="alert"]')).toBeTruthy();
    });
    const retryBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('retry') || b.textContent?.toLowerCase().includes('again')
    );
    expect(retryBtn).toBeDefined();
  });

  it('displays checkin note when history loads', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: [makeCheckin({ note: 'Great run today' })] });
    const { GoalCheckinModal } = await import('./GoalCheckinModal');
    render(<GoalCheckinModal {...defaultProps} />);

    const historyBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('history'));
    if (historyBtn) fireEvent.click(historyBtn);

    await waitFor(() => {
      expect(screen.getByText('Great run today')).toBeInTheDocument();
    });
  });

  it('hides submit button in history tab', async () => {
    const { GoalCheckinModal } = await import('./GoalCheckinModal');
    render(<GoalCheckinModal {...defaultProps} />);

    const historyBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('history'));
    if (historyBtn) fireEvent.click(historyBtn);

    await waitFor(() => {
      const buttonTexts = screen.getAllByRole('button').map((b) => b.textContent?.toLowerCase() || '');
      const hasSubmit = buttonTexts.some((t) => t.includes('submit') || t.includes('record') || t.includes('save'));
      expect(hasSubmit).toBe(false);
    });
  });
});
