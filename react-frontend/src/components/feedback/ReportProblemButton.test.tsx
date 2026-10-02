// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, userEvent } from '@/test/test-utils';
import { ReportProblemButton } from './ReportProblemButton';

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  captureSentryFeedback: vi.fn(),
  captureSentryMessage: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/contexts', () => ({
  useAuth: () => ({ isAuthenticated: true }),
  useAuthOptional: () => ({ isAuthenticated: true }),
  useToast: () => mocks.toast,
}));

vi.mock('@/lib/api', () => ({
  api: {
    post: (...args: unknown[]) => mocks.apiPost(...args),
  },
}));

vi.mock('@/lib/supportDiagnostics', async (importOriginal) => ({
  // Keep the real location helper so the F-281 test exercises what ships.
  ...(await importOriginal<typeof import('@/lib/supportDiagnostics')>()),
  getSupportDiagnosticsSnapshot: () => ({
    captured_at: '2026-05-27T00:00:00.000Z',
    entries: [{ kind: 'console', level: 'error', message: 'Captured error' }],
  }),
}));

vi.mock('@/lib/sentry', () => ({
  captureSentryFeedback: (...args: unknown[]) => mocks.captureSentryFeedback(...args),
  captureSentryMessage: (...args: unknown[]) => mocks.captureSentryMessage(...args),
}));

describe('ReportProblemButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.captureSentryMessage.mockReturnValue('sentry-event-123');
    mocks.apiPost.mockResolvedValue({
      success: true,
      data: {
        report: {
          id: 1,
          reference: 'NXR-260527-ABC123',
          status: 'open',
          impact: 'minor',
          summary: 'Checkout broken',
        },
      },
    });
  });

  it('submits a support report with diagnostics when selected', async () => {
    const user = userEvent.setup();
    render(<ReportProblemButton />);

    await user.click(screen.getByRole('button', { name: 'Help & support' }));
    await user.click(screen.getByRole('radio', { name: /Something isn't working/ }));
    await user.type(screen.getByLabelText('Short summary'), 'Checkout broken');
    await user.type(screen.getByLabelText('What happened?'), 'The checkout button does not respond.');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(1));
    expect(mocks.apiPost).toHaveBeenCalledWith('/v2/support/reports', expect.objectContaining({
      summary: 'Checkout broken',
      description: 'The checkout button does not respond.',
      request_type: 'broken',
      impact: 'minor',
      sentry_event_id: 'sentry-event-123',
      include_diagnostics: true,
      diagnostics: expect.objectContaining({
        entries: [expect.objectContaining({ message: 'Captured error' })],
      }),
    }));
    expect(mocks.captureSentryMessage).toHaveBeenCalledWith('Support report submitted', 'info', expect.objectContaining({
      impact: 'minor',
      has_diagnostics: true,
    }));
    expect(mocks.captureSentryFeedback).toHaveBeenCalledWith(expect.objectContaining({
      message: 'NXR-260527-ABC123: Checkout broken',
      source: 'support_report',
      associatedEventId: 'sentry-event-123',
      tags: expect.objectContaining({
        support_report_reference: 'NXR-260527-ABC123',
        impact: 'minor',
      }),
    }));
    expect(await screen.findByText('Reference NXR-260527-ABC123 has been created.')).toBeInTheDocument();
    // Once sent, only the confirmation is left: no form, no second Send.
    expect(screen.queryByLabelText('Short summary')).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    expect(screen.getByTestId('report-problem-footer')).toHaveTextContent('Close');
  });

  it('F-281: never sends the page query string or fragment, even with diagnostics off', async () => {
    const SECRET = 'f281-synthetic-token-9b3d';
    const originalPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.history.replaceState({}, '', `/partner-analytics?token=${SECRET}#impersonate=${SECRET}`);

    try {
      const user = userEvent.setup();
      render(<ReportProblemButton />);

      await user.click(screen.getByRole('button', { name: 'Help & support' }));
      await user.click(screen.getByRole('radio', { name: /Something isn't working/ }));
      await user.type(screen.getByLabelText('Short summary'), 'Checkout broken');
      await user.type(screen.getByLabelText('What happened?'), 'The checkout button does not respond.');
      await user.click(screen.getByRole('checkbox', { name: 'Include technical diagnostics from this page' }));
      await user.click(screen.getByRole('button', { name: 'Send' }));

      await waitFor(() => expect(mocks.captureSentryFeedback).toHaveBeenCalledTimes(1));

      const sent = JSON.stringify([
        mocks.apiPost.mock.calls,
        mocks.captureSentryMessage.mock.calls,
        mocks.captureSentryFeedback.mock.calls,
      ]);
      expect(sent).not.toContain(SECRET);

      // Control: the page is still identified, so staff can find it.
      expect(mocks.apiPost).toHaveBeenCalledWith('/v2/support/reports', expect.objectContaining({
        include_diagnostics: false,
        route: '/partner-analytics',
        page_url: `${window.location.origin}/partner-analytics`,
      }));
      expect(mocks.captureSentryFeedback).toHaveBeenCalledWith(expect.objectContaining({
        url: `${window.location.origin}/partner-analytics`,
      }));
    } finally {
      window.history.replaceState({}, '', originalPath);
    }
  });

  it('asks what kind of help is needed before showing any fields', async () => {
    const user = userEvent.setup();
    render(<ReportProblemButton />);

    await user.click(screen.getByRole('button', { name: 'Help & support' }));

    expect(screen.getByRole('radiogroup', { name: 'What do you need help with?' })).toBeInTheDocument();
    for (const option of [/Something isn't working/, /How do I/, /Account or sign-in problem/, /Suggest an improvement/]) {
      expect(screen.getByRole('radio', { name: option })).toBeInTheDocument();
    }
    expect(screen.queryByLabelText('Short summary')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('sends a question without impact, diagnostics or a Sentry event', async () => {
    const user = userEvent.setup();
    render(<ReportProblemButton />);

    await user.click(screen.getByRole('button', { name: 'Help & support' }));
    await user.click(screen.getByRole('radio', { name: /How do I/ }));

    expect(screen.queryByText('How much is this affecting you?')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Include technical diagnostics from this page' })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Your question in a few words'), 'Joining a group');
    await user.type(screen.getByLabelText('Tell us a bit more'), 'Where do I ask to join a group on my phone?');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(1));
    const [, payload] = mocks.apiPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload).toEqual(expect.objectContaining({
      request_type: 'how_to',
      summary: 'Joining a group',
      include_diagnostics: false,
    }));
    expect(payload).not.toHaveProperty('impact');
    expect(payload.diagnostics).toBeUndefined();
    expect(mocks.captureSentryMessage).not.toHaveBeenCalled();
    expect(mocks.captureSentryFeedback).not.toHaveBeenCalled();
    expect(await screen.findByText('Reference NXR-260527-ABC123 has been created.')).toBeInTheDocument();
  });

  it('warns members never to send their password with an account problem', async () => {
    const user = userEvent.setup();
    render(<ReportProblemButton />);

    await user.click(screen.getByRole('button', { name: 'Help & support' }));
    await user.click(screen.getByRole('radio', { name: /Account or sign-in problem/ }));

    expect(screen.getByText(/Never include your password/)).toBeInTheDocument();
  });

  it('shows the server message when the daily limit is reached', async () => {
    mocks.apiPost.mockResolvedValueOnce({ success: false, error: 'You have sent 5 reports in the last 24 hours.' });
    const user = userEvent.setup();
    render(<ReportProblemButton />);

    await user.click(screen.getByRole('button', { name: 'Help & support' }));
    await user.click(screen.getByRole('radio', { name: /Suggest an improvement/ }));
    await user.type(screen.getByLabelText('Your idea in a few words'), 'Dark map tiles');
    await user.type(screen.getByLabelText('Tell us a bit more about your idea'), 'The map is very bright at night.');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('You have sent 5 reports in the last 24 hours.'));
  });

  it('uses viewport-constrained scrollable modal layout', async () => {
    const user = userEvent.setup();
    render(<ReportProblemButton />);

    await user.click(screen.getByRole('button', { name: 'Help & support' }));

    expect(screen.getByTestId('report-problem-form')).toHaveClass('max-h-full', 'min-h-0', 'flex-col');
    expect(screen.getByTestId('report-problem-body')).toHaveClass('min-h-0', 'overflow-y-auto');
    expect(screen.getByTestId('report-problem-footer')).toHaveClass('shrink-0', 'items-stretch');
  });
});
