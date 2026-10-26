// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, userEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const { mockApi, mockToast } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/contexts', () => createMockContexts({ useToast: () => mockToast }));

import { ReportConcernModal } from './ReportConcernModal';

function renderModal(props: Partial<React.ComponentProps<typeof ReportConcernModal>> = {}) {
  const onClose = vi.fn();
  render(
    <ReportConcernModal
      targetKind="member"
      targetId={42}
      targetName="Sam Example"
      isOpen
      onClose={onClose}
      {...props}
    />,
  );
  return { onClose };
}

describe('ReportConcernModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('names the member, lists all six reasons with helper text, and says who will see it', () => {
    renderModal();

    expect(screen.getByText('Report Sam Example')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /someone may be at risk/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /harassment/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /inappropriate/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /scam or fraud/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^spam/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /something else/i })).toBeInTheDocument();
    expect(
      screen.getByText('You are worried someone is being harmed, exploited or put at risk'),
    ).toBeInTheDocument();
    expect(screen.getByText('Asking for money, bank details or personal information')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your community's coordinators will see this. The person you report is not told who reported them.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('If someone is in immediate danger, contact the emergency services.'),
    ).toBeInTheDocument();
  });

  it('uses the message heading for a message report', () => {
    renderModal({ targetKind: 'message', targetId: 7 });
    expect(screen.getByText('Report this message')).toBeInTheDocument();
  });

  it('sends the chosen reason and details to the member endpoint and thanks the member', async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({ success: true, data: { reported: true, report_id: 9 } });
    renderModal();

    await user.click(screen.getByRole('radio', { name: /harassment/i }));
    await user.type(screen.getByRole('textbox'), 'Keeps messaging me late at night');
    await user.click(screen.getByRole('button', { name: 'Send report' }));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/users/42/report', {
        category: 'harassment',
        details: 'Keeps messaging me late at night',
      });
    });
    expect(
      await screen.findByText("Thank you. Your report has been sent to your community's coordinators."),
    ).toBeInTheDocument();
  });

  it('posts a message report to the message endpoint without empty details', async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({ success: true, data: { reported: true, report_id: 3 } });
    renderModal({ targetKind: 'message', targetId: 77 });

    await user.click(screen.getByRole('radio', { name: /scam or fraud/i }));
    await user.click(screen.getByRole('button', { name: 'Send report' }));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/messages/77/report', { category: 'scam_or_fraud' });
    });
  });

  it('requires a description when the reason is "something else"', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('radio', { name: /something else/i }));
    await user.click(screen.getByRole('button', { name: 'Send report' }));

    expect(await screen.findByText('Please describe your concern.')).toBeInTheDocument();
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('asks for a reason before sending', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('button', { name: 'Send report' }));

    expect(await screen.findByText('Choose a reason for your report.')).toBeInTheDocument();
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('shows an already-reported answer as information, not an error', async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({
      success: false,
      code: 'ALREADY_REPORTED',
      error: 'You have already reported this member. Coordinators are looking at it.',
    });
    renderModal();

    await user.click(screen.getByRole('radio', { name: /^spam/i }));
    await user.click(screen.getByRole('button', { name: 'Send report' }));

    expect(
      await screen.findByText('You have already reported this member. Coordinators are looking at it.'),
    ).toBeInTheDocument();
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the server message when the report is refused', async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({
      success: false,
      code: 'CANNOT_REPORT_SELF',
      error: 'You cannot report yourself.',
    });
    renderModal();

    await user.click(screen.getByRole('radio', { name: /^spam/i }));
    await user.click(screen.getByRole('button', { name: 'Send report' }));

    expect(await screen.findByText('You cannot report yourself.')).toBeInTheDocument();
    expect(screen.queryByText("Thank you. Your report has been sent to your community's coordinators.")).toBeNull();
  });

  it('limits details to 2000 characters and shows a counter', () => {
    renderModal();
    const textbox = screen.getByRole('textbox');
    expect(textbox).toHaveAttribute('maxlength', '2000');
    expect(screen.getByText('0/2000')).toBeInTheDocument();
  });
});
