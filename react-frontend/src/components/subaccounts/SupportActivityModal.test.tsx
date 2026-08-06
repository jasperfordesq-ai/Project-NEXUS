// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn() },
  api: { get: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/contexts', () => createMockContexts());

import { api } from '@/lib/api';
import { SupportActivityModal } from './SupportActivityModal';

const mockedGet = vi.mocked(api.get);

const fullSummary = {
  hours_summary: {
    hours_given: 12.5,
    hours_received: 3,
    transactions_given: 9,
    transactions_received: 2,
    net_balance: -9.5,
  },
  connection_stats: { total_connections: 4, pending_requests: 1, groups_joined: 2 },
  engagement: { posts_count: 6, comments_count: 3, likes_given: 5, likes_received: 8, period: 'last_30_days' },
  timeline: [
    { id: 1, activity_type: 'gave_hours', description: '2 hour(s)', created_at: '2026-08-01T10:00:00Z' },
    { id: 2, activity_type: 'post', description: 'Hello from the garden group', created_at: '2026-08-02T10:00:00Z' },
  ],
};

function renderModal() {
  return render(
    <SupportActivityModal
      isOpen
      onOpenChange={() => {}}
      supportedUserId={42}
      supportedName="Molly Member"
    />,
  );
}

describe('SupportActivityModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the activity endpoint for the supported member and renders the summary', async () => {
    mockedGet.mockResolvedValue({ success: true, data: fullSummary } as never);
    renderModal();

    expect(mockedGet).toHaveBeenCalledWith('/v2/users/me/sub-accounts/42/activity');

    expect(await screen.findByText('Activity for Molly Member')).toBeInTheDocument();
    expect(screen.getByText('Hours given')).toBeInTheDocument();
    expect(screen.getByText('12.5')).toBeInTheDocument();
    expect(screen.getByText('Net balance')).toBeInTheDocument();
    expect(screen.getByText('-9.5')).toBeInTheDocument();
    expect(screen.getByText('Hello from the garden group')).toBeInTheDocument();
  });

  /**
   * 🔴 Read-only is the contract: seeing is `assist`, doing is a different
   * tier. If an action button ever appears in this modal, the tier boundary
   * has been breached — SupportPrepareModal is where acting lives.
   */
  it('offers no action buttons — Close is the only labelled button', async () => {
    mockedGet.mockResolvedValue({ success: true, data: fullSummary } as never);
    renderModal();

    await screen.findByText('Activity for Molly Member');
    // The dialog chrome may add an unlabelled dismiss control; the contract is
    // that no ACTING affordance exists — labelled buttons are Close and
    // nothing else, and no prepare/act vocabulary appears anywhere.
    const labelled = screen.getAllByRole('button')
      .map((b) => b.textContent?.trim())
      .filter((label): label is string => Boolean(label));
    expect(labelled).toEqual(['Close']);
    expect(screen.queryByText(/Do it now|Send for their approval/)).not.toBeInTheDocument();
  });

  it('shows the plain failure message when the grant no longer permits viewing', async () => {
    mockedGet.mockResolvedValue({ success: false, error: 'You do not have permission to do this for that account' } as never);
    renderModal();

    expect(await screen.findByTestId('support-activity-error')).toHaveTextContent(
      'You do not have permission to do this for that account',
    );
    expect(screen.queryByText('Hours given')).not.toBeInTheDocument();
  });

  it('falls back to the generic failure message when the response carries no error text', async () => {
    mockedGet.mockResolvedValue({ success: false } as never);
    renderModal();

    expect(await screen.findByTestId('support-activity-error')).toHaveTextContent(
      'Their activity could not be loaded. The permission may have been changed.',
    );
  });

  it('says plainly when there is nothing recent, rather than showing an empty region', async () => {
    mockedGet.mockResolvedValue({
      success: true,
      data: { ...fullSummary, timeline: [] },
    } as never);
    renderModal();

    expect(await screen.findByText('Nothing recent to show.')).toBeInTheDocument();
  });

  /** A server-side vocabulary word the client does not know must render as the
   *  generic label — never leak the raw code into member-facing text. */
  it('labels unknown timeline types generically instead of leaking the code', async () => {
    mockedGet.mockResolvedValue({
      success: true,
      data: {
        ...fullSummary,
        timeline: [{ id: 9, activity_type: 'brand_new_type', description: 'Something', created_at: '2026-08-03T10:00:00Z' }],
      },
    } as never);
    renderModal();

    await screen.findByText('Something');
    expect(screen.getByText(/Activity ·/)).toBeInTheDocument();
    expect(screen.queryByText(/brand_new_type/)).not.toBeInTheDocument();
  });

  it('caps the timeline at ten entries', async () => {
    const timeline = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      activity_type: 'post',
      description: `Item ${i + 1}`,
      created_at: '2026-08-01T10:00:00Z',
    }));
    mockedGet.mockResolvedValue({ success: true, data: { ...fullSummary, timeline } } as never);
    renderModal();

    await screen.findByText('Item 1');
    expect(screen.getByText('Item 10')).toBeInTheDocument();
    expect(screen.queryByText('Item 11')).not.toBeInTheDocument();
  });

  it('does not fetch while closed', async () => {
    mockedGet.mockResolvedValue({ success: true, data: fullSummary } as never);
    render(
      <SupportActivityModal
        isOpen={false}
        onOpenChange={() => {}}
        supportedUserId={42}
        supportedName="Molly Member"
      />,
    );

    await waitFor(() => expect(mockedGet).not.toHaveBeenCalled());
  });
});
