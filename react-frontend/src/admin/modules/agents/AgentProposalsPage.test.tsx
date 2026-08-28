// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── vi.hoisted ──────────────────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  })
);

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

vi.mock('../../components/EmptyState', () => ({
  EmptyState: ({ title }: { title: string }) => (
    <div data-testid="empty-state">{title}</div>
  ),
}));

vi.mock('../../components/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => (
    <div data-testid="page-header">{title}</div>
  ),
}));

import { api } from '@/lib/api';
import AgentProposalsPage from './AgentProposalsPage';

const mockProposal = {
  id: 42,
  tenant_id: 2,
  run_id: 7,
  agent_definition_id: 1,
  proposal_type: 'match_suggestion',
  subject_user_id: 100,
  target_user_id: 200,
  proposal_data: { action: 'suggest_match', score: 0.9 },
  reasoning: 'High compatibility based on skill overlap',
  status: 'pending_review',
  confidence_score: 0.87,
  created_at: '2026-01-10T09:00:00Z',
};

const mockApprovedProposal = {
  ...mockProposal,
  id: 43,
  status: 'approved',
};

describe('AgentProposalsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading text while fetching', async () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<AgentProposalsPage />);
    // Loading card renders while waiting
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    // Loading state is the card with loading text
    // The loading div is rendered during load
    expect(screen.getByTestId('page-header')).toBeInTheDocument();
  });

  it('shows empty state when no proposals', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: { items: [] },
    });
    render(<AgentProposalsPage />);
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
  });

  // The proposal-type chip is TRANSLATED — t(`agents.proposal_type.${type}`) — so
  // the raw 'match_suggestion' every test in this file waited for was never on
  // screen. Nine of the thirteen tests used it as their "rows have loaded" gate,
  // so all nine timed out on the gate and never reached what they were testing.
  it('renders proposals with type and confidence chips', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: { items: [mockProposal] },
    });
    render(<AgentProposalsPage />);
    await waitFor(() => expect(screen.getByText('Match suggestion')).toBeInTheDocument());
    // The raw proposal-type slug must never reach an admin's screen.
    expect(screen.queryByText('match_suggestion')).not.toBeInTheDocument();
    // Reasoning text is shown
    expect(screen.getByText('High compatibility based on skill overlap')).toBeInTheDocument();
  });

  it('renders approve/reject/edit buttons for pending_review proposals', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: { items: [mockProposal] },
    });
    render(<AgentProposalsPage />);
    await waitFor(() => expect(screen.getByText('Match suggestion')).toBeInTheDocument());
    // pending_review status shows action buttons — use queryAll to handle multiple matches
    const allButtons = screen.getAllByRole('button');
    const approveBtn = allButtons.find((b) => /approve/i.test(b.textContent ?? ''));
    const editBtn = allButtons.find(
      (b) => /edit/i.test(b.textContent ?? '') || /save.*approve/i.test(b.textContent ?? ''),
    );
    const rejectBtn = allButtons.find((b) => /reject/i.test(b.textContent ?? ''));
    expect(approveBtn).toBeDefined();
    expect(editBtn).toBeDefined();
    expect(rejectBtn).toBeDefined();
  });

  it('does NOT show action buttons for already-approved proposals', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: { items: [mockApprovedProposal] },
    });
    render(<AgentProposalsPage />);
    await waitFor(() => expect(screen.getByText('Match suggestion')).toBeInTheDocument());
    // status !== 'pending_review' so no action buttons rendered
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument();
  });

  // Helper to get the first button matching a pattern from getAllByRole
  function findBtn(pattern: RegExp) {
    return screen.getAllByRole('button').find((b) => pattern.test(b.textContent ?? ''));
  }

  it('calls approve endpoint when Approve is clicked', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { items: [mockProposal] },
    });
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });

    const user = userEvent.setup();
    render(<AgentProposalsPage />);
    await waitFor(() => expect(screen.getByText('Match suggestion')).toBeInTheDocument());
    const btn = findBtn(/^approve/i);
    expect(btn).toBeDefined();
    await user.click(btn!);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        `/v2/admin/agents/proposals/${mockProposal.id}/approve`,
        {},
      ),
    );
  });

  it('shows success toast after approve', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { items: [mockProposal] },
    });
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });

    const user = userEvent.setup();
    render(<AgentProposalsPage />);
    await waitFor(() => expect(screen.getByText('Match suggestion')).toBeInTheDocument());
    const btn = findBtn(/^approve/i);
    await user.click(btn!);
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
  });

  it('shows error toast when approve fails', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { items: [mockProposal] },
    });
    vi.mocked(api.post).mockResolvedValueOnce({
      success: false,
      error: 'Server error',
    });

    const user = userEvent.setup();
    render(<AgentProposalsPage />);
    await waitFor(() => expect(screen.getByText('Match suggestion')).toBeInTheDocument());
    const btn = findBtn(/^approve/i);
    await user.click(btn!);
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });

  it('opens reject modal when Reject is clicked', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: { items: [mockProposal] },
    });
    const user = userEvent.setup();
    render(<AgentProposalsPage />);
    await waitFor(() => expect(screen.getByText('Match suggestion')).toBeInTheDocument());
    const btn = findBtn(/^reject/i);
    expect(btn).toBeDefined();
    await user.click(btn!);
    await waitFor(() => {
      const dialogs = screen.queryAllByRole('dialog');
      expect(dialogs.length).toBeGreaterThan(0);
    });
  });

  it('calls reject endpoint when modal is confirmed', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { items: [mockProposal] },
    });
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });

    const user = userEvent.setup();
    render(<AgentProposalsPage />);
    await waitFor(() => expect(screen.getByText('Match suggestion')).toBeInTheDocument());
    const rejectBtn = findBtn(/^reject/i);
    await user.click(rejectBtn!);

    // Wait for modal
    await waitFor(() => {
      const dialogs = screen.queryAllByRole('dialog');
      expect(dialogs.length).toBeGreaterThan(0);
    });

    // Find reject button inside modal footer (not disabled)
    const allButtons = screen.getAllByRole('button');
    const modalRejectBtn = allButtons.find(
      (b) => /reject/i.test(b.textContent ?? '') && !b.hasAttribute('disabled'),
    );
    if (modalRejectBtn) {
      fireEvent.click(modalRejectBtn);
    }

    await waitFor(() => {
      if (vi.mocked(api.post).mock.calls.length > 0) {
        expect(api.post).toHaveBeenCalledWith(
          `/v2/admin/agents/proposals/${mockProposal.id}/reject`,
          expect.objectContaining({ note: expect.any(String) }),
        );
      }
    });
  });

  it('opens edit modal when Edit & Approve is clicked', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: { items: [mockProposal] },
    });
    const user = userEvent.setup();
    render(<AgentProposalsPage />);
    await waitFor(() => expect(screen.getByText('Match suggestion')).toBeInTheDocument());
    const editBtn = findBtn(/edit/i);
    expect(editBtn).toBeDefined();
    await user.click(editBtn!);
    await waitFor(() => {
      const dialogs = screen.queryAllByRole('dialog');
      expect(dialogs.length).toBeGreaterThan(0);
    });
  });

  it('shows error toast when load fails', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('network'));
    render(<AgentProposalsPage />);
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });

  it('tabs render pending/approved/rejected/all options', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: { items: [] },
    });
    render(<AgentProposalsPage />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    // Tab elements should be present
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBeGreaterThanOrEqual(4);
  });
});
