// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, userEvent, within } from '@/test/test-utils';
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

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...actual,
    formatRelativeTime: (d: string) => d,
  };
});

// ─── Contexts ─────────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/components/seo/PageMeta', () => ({
  PageMeta: () => null,
}));

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description, action }: { title: string; description?: string; action?: { label: string; onClick: () => void } }) => (
    <div data-testid="empty-state">
      <p>{title}</p>
      {description && <p>{description}</p>}
      {action && <button onClick={action.onClick}>{action.label}</button>}
    </div>
  ),
}));

vi.mock('@/components/ui/SafeHtml', () => ({
  SafeHtml: ({ content }: { content: string }) => <p>{content}</p>,
}));

// The Modal family and useDisclosure are deliberately NOT stubbed here. GroupChallengesTab imports
// both from '@/components/ui/Modal' and '@/components/ui/useDisclosure', so the overrides this
// block used to carry were dead and the real HeroUI Modal has always been what rendered — which is
// what the create-flow tests below depend on. The real Modal marks the page behind it aria-hidden,
// so getByRole finds only the submit button inside the dialog; an inline stub leaves the trigger
// visible too and the "Create Challenge" queries become ambiguous. The real components work in
// jsdom here, so the dead overrides were removed rather than activated.
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    GlassCard: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
    Button: ({ children, onPress, isLoading, isDisabled, onClick, startContent, 'aria-expanded': ariaExpanded, ...rest }: { children?: React.ReactNode; onPress?: () => void; isLoading?: boolean; isDisabled?: boolean; onClick?: React.MouseEventHandler; startContent?: React.ReactNode; 'aria-expanded'?: boolean; [key: string]: unknown }) => (
      <button
        onClick={(e) => { onClick?.(e); onPress?.(); }}
        disabled={isLoading || isDisabled}
        aria-expanded={ariaExpanded}
        data-loading={isLoading ? 'true' : undefined}
      >
        {isLoading ? 'Loading…' : children}
      </button>
    ),
    Input: ({ label, value, onChange, onValueChange, type, placeholder, isRequired }: { label?: string; value?: string; onChange?: React.ChangeEventHandler; onValueChange?: (v: string) => void; type?: string; placeholder?: string; isRequired?: boolean; [key: string]: unknown }) => (
      <div>
        {label && <label>{label}</label>}
        <input
          type={type || 'text'}
          value={value}
          placeholder={placeholder}
          required={isRequired}
          onChange={(e) => { onChange?.(e); onValueChange?.(e.target.value); }}
          aria-label={label}
        />
      </div>
    ),
    Textarea: ({ label, value, onChange, onValueChange, placeholder, isRequired }: { label?: string; value?: string; onChange?: React.ChangeEventHandler; onValueChange?: (v: string) => void; placeholder?: string; isRequired?: boolean; [key: string]: unknown }) => (
      <div>
        {label && <label>{label}</label>}
        <textarea
          value={value}
          placeholder={placeholder}
          required={isRequired}
          onChange={(e) => { onChange?.(e); onValueChange?.(e.target.value); }}
          aria-label={label}
        />
      </div>
    ),
    Select: ({ label, children, onSelectionChange }: { label?: string; children: React.ReactNode; selectedKeys?: string[]; onSelectionChange?: (keys: Set<string>) => void }) => (
      <div>
        {label && <label>{label}</label>}
        <select aria-label={label} onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}>
          {children}
        </select>
      </div>
    ),
    SelectItem: ({ children, id }: { children: React.ReactNode; id?: string; key?: string }) => (
      <option value={id}>{children}</option>
    ),
    Spinner: () => <div role="status" aria-busy="true" aria-label="Loading" />,
    Progress: ({ value, 'aria-label': ariaLabel }: { value: number; 'aria-label': string }) => (
      <div role="progressbar" aria-valuenow={value} aria-label={ariaLabel} />
    ),
    Chip: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    // useDisclosure is deliberately NOT overridden. GroupChallengesTab imports it from
    // '@/components/ui/useDisclosure', so the override that used to sit here was dead and the real
    // hook has always been what ran. Re-registering this always-closed stub on the direct path
    // would make onOpen a no-op and permanently wedge the dialog shut — live but wrong, which is
    // worse than dead. The real hook works here, so the dead override was removed instead.
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const { makeChallenge } = vi.hoisted(() => ({
  makeChallenge: (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    group_id: 5,
    title: 'Post 10 times',
    description: 'Create 10 posts this month',
    metric: 'posts' as const,
    target_value: 10,
    current_value: 6,
    reward_xp: 100,
    status: 'active',
    progress_percentage: 60,
    starts_at: '2025-01-01T00:00:00Z',
    ends_at: '2099-12-31T00:00:00Z',
    completed_at: null,
    creator: { id: 1, name: 'Admin User', avatar_url: null },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }),
}));

const makeSuccessResponse = (data: unknown) => ({ success: true, data });

// ─────────────────────────────────────────────────────────────────────────────

describe('GroupChallengesTab', () => {
  const defaultProps = { groupId: 5, isAdmin: false };

  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue(makeSuccessResponse([]));
  });

  it('shows loading spinner initially', async () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab {...defaultProps} />);
    const statusEls = screen.getAllByRole('status');
    const busy = statusEls.find(el => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('shows empty state when no challenges exist', async () => {
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('shows non-admin empty state description', async () => {
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab {...defaultProps} isAdmin={false} />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      // Admin-only create button should NOT appear in empty state for non-admins
      // (no action button)
    });
  });

  it('shows admin empty state with create button', async () => {
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab {...defaultProps} isAdmin={true} />);
    await waitFor(() => {
      const emptyState = screen.getByTestId('empty-state');
      expect(emptyState).toBeInTheDocument();
      // Admin-specific action button in empty state
      const createBtn = emptyState.querySelector('button');
      expect(createBtn).toBeTruthy();
    });
  });

  it('renders active challenge card with title', async () => {
    mockApi.get.mockResolvedValue(makeSuccessResponse([makeChallenge()]));
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Post 10 times')).toBeInTheDocument();
    });
  });

  it('renders challenge description', async () => {
    mockApi.get.mockResolvedValue(makeSuccessResponse([makeChallenge()]));
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Create 10 posts this month')).toBeInTheDocument();
    });
  });

  it('shows progress bar for each challenge', async () => {
    mockApi.get.mockResolvedValue(makeSuccessResponse([makeChallenge()]));
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab {...defaultProps} />);
    await waitFor(() => {
      const progressbars = screen.getAllByRole('progressbar');
      expect(progressbars.length).toBeGreaterThan(0);
      // 6/10 = 60%
      expect(progressbars[0]).toHaveAttribute('aria-valuenow', '60');
    });
  });

  it('shows creator name', async () => {
    mockApi.get.mockResolvedValue(makeSuccessResponse([makeChallenge()]));
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText(/Admin User/)).toBeInTheDocument();
    });
  });

  it('shows create challenge button for admins', async () => {
    mockApi.get.mockResolvedValue(makeSuccessResponse([makeChallenge()]));
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab {...defaultProps} isAdmin={true} />);
    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      // t('challenges.create') translates to "Create Challenge"
      const createBtn = buttons.find(b =>
        b.textContent?.toLowerCase().includes('create challenge') ||
        b.textContent?.includes('challenges.create')
      );
      expect(createBtn).toBeDefined();
    });
  });

  it('does not show create button for non-admins', async () => {
    mockApi.get.mockResolvedValue(makeSuccessResponse([makeChallenge()]));
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab {...defaultProps} isAdmin={false} />);
    await waitFor(() => screen.getByText('Post 10 times'));
    const buttons = screen.queryAllByRole('button');
    // With non-admin + active challenge only: no create button
    const createBtn = buttons.find(b => b.textContent?.includes('challenges.create') || b.textContent?.toLowerCase().includes('create challenge'));
    expect(createBtn).toBeUndefined();
  });

  it('shows active-challenge cancellation only to group admins and requires explicit confirmation', async () => {
    mockApi.get.mockResolvedValue(makeSuccessResponse([makeChallenge()]));
    mockApi.delete.mockResolvedValue({
      success: true,
      data: {
        challenge: makeChallenge({ status: 'cancelled' }),
        changed: true,
        message: 'cancelled',
      },
    });
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    const { rerender } = render(<GroupChallengesTab {...defaultProps} isAdmin={false} />);

    await screen.findByText('Post 10 times');
    expect(screen.queryByRole('button', { name: 'Cancel challenge “Post 10 times”' })).not.toBeInTheDocument();

    rerender(<GroupChallengesTab {...defaultProps} isAdmin />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel challenge “Post 10 times”' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Cancel challenge?')).toBeInTheDocument();
    expect(within(dialog).getByText(/Stop progress for “Post 10 times”/)).toBeInTheDocument();
    expect(mockApi.delete).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel challenge' }));
    await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('/v2/groups/5/challenges/1'));
    await waitFor(() => expect(screen.getByText('Cancelled')).toBeInTheDocument());
    expect(screen.getByText('Post 10 times')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel challenge “Post 10 times”' })).not.toBeInTheDocument();
    expect(mockToast.success).toHaveBeenCalledWith('Challenge cancelled');
  });

  it('keeps the active challenge and confirmation open when cancellation fails', async () => {
    mockApi.get.mockResolvedValue(makeSuccessResponse([makeChallenge()]));
    mockApi.delete.mockResolvedValue({ success: false, code: 'HTTP_500' });
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab {...defaultProps} isAdmin />);

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel challenge “Post 10 times”' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel challenge' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Failed to cancel challenge'));
    expect(screen.getByText('Post 10 times')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('disables destructive dialog actions while cancellation is in flight', async () => {
    let resolveCancel: ((value: {
      success: boolean;
      data: { challenge: ReturnType<typeof makeChallenge>; changed: boolean; message: string };
    }) => void) | undefined;
    mockApi.get.mockResolvedValue(makeSuccessResponse([makeChallenge()]));
    mockApi.delete.mockImplementation(() => new Promise((resolve) => { resolveCancel = resolve; }));
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab {...defaultProps} isAdmin />);

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel challenge “Post 10 times”' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel challenge' }));

    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
      expect(within(dialog).getByRole('button', { name: 'Cancel challenge' })).toBeDisabled();
    });

    resolveCancel?.({
      success: true,
      data: {
        challenge: makeChallenge({ status: 'cancelled' }),
        changed: true,
        message: 'cancelled',
      },
    });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('surfaces an immutable completion race and refreshes away the stale cancel action', async () => {
    mockApi.get
      .mockResolvedValueOnce(makeSuccessResponse([makeChallenge()]))
      .mockResolvedValueOnce(makeSuccessResponse([
        makeChallenge({ status: 'completed', completed_at: '2026-07-11T09:00:00Z', current_value: 10, progress_percentage: 100 }),
      ]));
    mockApi.delete.mockResolvedValue({
      success: false,
      status: 409,
      code: 'CHALLENGE_IMMUTABLE',
    });
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab {...defaultProps} isAdmin />);

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel challenge “Post 10 times”' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel challenge' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Completed or rewarded challenges cannot be cancelled.'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel challenge “Post 10 times”' })).not.toBeInTheDocument());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows completed challenge with completed chip', async () => {
    mockApi.get.mockResolvedValue(makeSuccessResponse([
      makeChallenge({ status: 'completed', completed_at: '2025-06-01T00:00:00Z', current_value: 10, progress_percentage: 100 }),
    ]));
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab {...defaultProps} />);
    await userEvent.click(await screen.findByRole('button', { name: /Challenge history/ }));
    await waitFor(() => {
      // challenges.completed_chip translation key
      expect(screen.getAllByText(/completed_chip|completed/i).length).toBeGreaterThan(0);
    });
  });

  it('shows completed section toggle when completed challenges exist', async () => {
    mockApi.get.mockResolvedValue(makeSuccessResponse([
      makeChallenge({ id: 1, status: 'active' }),
      makeChallenge({ id: 2, title: 'Done challenge', status: 'completed', current_value: 10, progress_percentage: 100 }),
    ]));
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab {...defaultProps} />);
    const toggleButton = await screen.findByRole('button', { name: /Challenge history/ });
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggleButton);
    expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Done challenge')).toBeInTheDocument();
  });

  it('calls api.get for the correct group challenges endpoint', async () => {
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab {...defaultProps} />);
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(
        '/v2/groups/5/challenges?all=1',
        { signal: expect.any(AbortSignal) },
      );
    });
  });

  it('shows error toast when load fails', async () => {
    mockApi.get.mockRejectedValue(new Error('network'));
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab {...defaultProps} />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows a truthful retryable error instead of the empty state', async () => {
    mockApi.get
      .mockResolvedValueOnce({ success: false, code: 'HTTP_500' })
      .mockResolvedValueOnce(makeSuccessResponse([makeChallenge({ title: 'Recovered challenge' })]));
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab {...defaultProps} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load challenges');
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(await screen.findByText('Recovered challenge')).toBeInTheDocument();
  });

  it('ignores a stale response after the group changes', async () => {
    let resolveFirst: ((value: ReturnType<typeof makeSuccessResponse>) => void) | undefined;
    const firstRequest = new Promise<ReturnType<typeof makeSuccessResponse>>((resolve) => {
      resolveFirst = resolve;
    });
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/groups/5/')) return firstRequest;
      return Promise.resolve(makeSuccessResponse([makeChallenge({ title: 'Current group challenge' })]));
    });

    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    const { rerender } = render(<GroupChallengesTab groupId={5} isAdmin={false} />);
    rerender(<GroupChallengesTab groupId={6} isAdmin={false} />);

    expect(await screen.findByText('Current group challenge')).toBeInTheDocument();
    resolveFirst?.(makeSuccessResponse([makeChallenge({ title: 'Stale group challenge' })]));
    await waitFor(() => expect(screen.queryByText('Stale group challenge')).not.toBeInTheDocument());
  });

  it('handles array-wrapped response shape', async () => {
    mockApi.get.mockResolvedValue(makeSuccessResponse([makeChallenge({ title: 'Array shape' })]));
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Array shape')).toBeInTheDocument();
    });
  });

  it('rejects the legacy challenges envelope instead of showing stale data', async () => {
    mockApi.get.mockResolvedValue(makeSuccessResponse({ challenges: [makeChallenge({ title: 'Object shape' })] }));
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab {...defaultProps} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load challenges');
    expect(screen.queryByText('Object shape')).not.toBeInTheDocument();
  });
});

// ─── Create Challenge (modal tests) — only viable if we spy on useDisclosure ──
// Note: useDisclosure is mocked to return isOpen=false by default, so the modal
// is not rendered on initial load. We test the create flow via the empty-state
// admin button which calls onOpen().

describe('GroupChallengesTab — create flow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('calls api.post when create form submitted with all required fields', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: [] });
    mockApi.post.mockResolvedValue({ success: true, data: makeChallenge({ id: 99, current_value: 0, progress_percentage: 0 }) });

    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab groupId={5} isAdmin={true} />);

    await userEvent.click((await screen.findAllByRole('button', { name: 'Create Challenge' }))[0]);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Reward XP' })).not.toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), 'New Challenge');
    await userEvent.type(screen.getByRole('textbox', { name: 'Description' }), 'Do something great');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Target Value' }), { target: { value: '10' } });
    fireEvent.change(document.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: '2099-12-31' } });

    await userEvent.click(screen.getByRole('button', { name: 'Create Challenge' }));
    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/groups/5/challenges', expect.objectContaining({
        title: 'New Challenge',
        description: 'Do something great',
        target_value: 10,
        reward_xp: 0,
        ends_at: '2099-12-31',
      }));
    });
  });

  it('offers only implemented metrics and server-defined reward bands', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: [] });
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab groupId={5} isAdmin={true} />);

    await userEvent.click((await screen.findAllByRole('button', { name: 'Create Challenge' }))[0]);

    const metricTrigger = screen.getByRole('button', { name: /Metric/i });
    await userEvent.click(metricTrigger);
    expect(await screen.findByRole('option', { name: 'Posts' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Discussions' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Members' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Files' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Events' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: 'Posts' }));

    const rewardTrigger = screen.getByRole('button', { name: /Reward XP/i });
    await userEvent.click(rewardTrigger);
    for (const reward of ['0 XP', '25 XP', '50 XP', '100 XP']) {
      expect(await screen.findByRole('option', { name: reward })).toBeInTheDocument();
    }
  });

  it('shows translated validation errors instead of silently ignoring an invalid form', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: [] });
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab groupId={5} isAdmin={true} />);

    await userEvent.click((await screen.findAllByRole('button', { name: 'Create Challenge' }))[0]);
    const createButtons = await screen.findAllByRole('button', { name: 'Create Challenge' });
    await userEvent.click(createButtons[createButtons.length - 1]);

    expect((await screen.findAllByText('Required')).length).toBeGreaterThanOrEqual(3);
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('does not show a success toast for a resolved create failure', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: [] });
    mockApi.post.mockResolvedValue({ success: false, code: 'HTTP_422' });

    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab groupId={5} isAdmin={true} />);

    await userEvent.click((await screen.findAllByRole('button', { name: 'Create Challenge' }))[0]);
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), 'New Challenge');
    await userEvent.type(screen.getByRole('textbox', { name: 'Description' }), 'Do something great');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Target Value' }), { target: { value: '10' } });
    fireEvent.change(document.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: '2099-12-31' } });

    await userEvent.click(screen.getByRole('button', { name: 'Create Challenge' }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('closes the create modal without submitting when cancel is pressed', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: [] });
    const { GroupChallengesTab } = await import('./GroupChallengesTab');
    render(<GroupChallengesTab groupId={5} isAdmin={true} />);

    await userEvent.click((await screen.findAllByRole('button', { name: 'Create Challenge' }))[0]);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockApi.post).not.toHaveBeenCalled();
  });
});
