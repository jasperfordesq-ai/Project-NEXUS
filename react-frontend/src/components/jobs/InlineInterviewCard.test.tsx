// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import { InlineInterviewCard } from './InlineInterviewCard';
import type { InlineInterview } from './JobDetailTypes';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn().mockResolvedValue(new Blob()),
  },
  API_BASE: '/api',
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/contexts', () => createMockContexts());

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// formatDateTime is used to display the scheduled_at time; mock to make assertions stable
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  formatDateTime: (v: string) => `Formatted(${v})`,
  resolveAvatarUrl: (v: string | null) => v ?? '',
}));

const PROPOSED_INTERVIEW: InlineInterview = {
  id: 10,
  application_id: 5,
  scheduled_at: '2026-07-01T10:00:00Z',
  interview_type: 'video',
  status: 'proposed',
  meeting_link: null,
  location_notes: null,
  duration_mins: 30,
};

describe('InlineInterviewCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when status is not "proposed"', () => {
    render(
      <InlineInterviewCard
        pendingInterview={{ ...PROPOSED_INTERVIEW, status: 'accepted' }}
        isResponding={false}
        onAccept={vi.fn()}
        onDeclineOpen={vi.fn()}
      />
    );
    // When status !== 'proposed' the component returns null — no GlassCard/interview heading
    // The ToastProvider wrapper still renders but the interview card itself should be absent
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    // No accept/decline buttons should be present
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders interview card when status is "proposed"', () => {
    render(
      <InlineInterviewCard
        pendingInterview={PROPOSED_INTERVIEW}
        isResponding={false}
        onAccept={vi.fn()}
        onDeclineOpen={vi.fn()}
      />
    );
    // heading text comes from i18n key inline_response.interview_pending
    expect(screen.getByText(/Formatted\(2026-07-01T10:00:00Z\)/)).toBeInTheDocument();
  });

  it('shows duration when provided', () => {
    render(
      <InlineInterviewCard
        pendingInterview={{ ...PROPOSED_INTERVIEW, duration_mins: 45 }}
        isResponding={false}
        onAccept={vi.fn()}
        onDeclineOpen={vi.fn()}
      />
    );
    // The duration renders as "45 min" but is split across text nodes —
    // use a regex matcher that finds "45" anywhere in the document
    expect(screen.getByText((content) => content.includes('45'))).toBeInTheDocument();
  });

  it('calls onAccept when accept button is pressed', () => {
    const onAccept = vi.fn();
    render(
      <InlineInterviewCard
        pendingInterview={PROPOSED_INTERVIEW}
        isResponding={false}
        onAccept={onAccept}
        onDeclineOpen={vi.fn()}
      />
    );
    // HeroUI Button with onPress — fireEvent.click is sufficient
    const buttons = screen.getAllByRole('button');
    // Accept button is the first action button (success colour)
    const acceptBtn = buttons.find((b) => b.textContent?.toLowerCase().includes('accept'));
    expect(acceptBtn).toBeDefined();
    fireEvent.click(acceptBtn!);
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('calls onDeclineOpen when decline button is pressed', () => {
    const onDeclineOpen = vi.fn();
    render(
      <InlineInterviewCard
        pendingInterview={PROPOSED_INTERVIEW}
        isResponding={false}
        onAccept={vi.fn()}
        onDeclineOpen={onDeclineOpen}
      />
    );
    const buttons = screen.getAllByRole('button');
    const declineBtn = buttons.find((b) => b.textContent?.toLowerCase().includes('decline'));
    expect(declineBtn).toBeDefined();
    fireEvent.click(declineBtn!);
    expect(onDeclineOpen).toHaveBeenCalledTimes(1);
  });

  it('decline button is disabled while isResponding', () => {
    render(
      <InlineInterviewCard
        pendingInterview={PROPOSED_INTERVIEW}
        isResponding={true}
        onAccept={vi.fn()}
        onDeclineOpen={vi.fn()}
      />
    );
    const buttons = screen.getAllByRole('button');
    const declineBtn = buttons.find((b) => b.textContent?.toLowerCase().includes('decline'));
    // HeroUI sets native disabled on <button> elements when isDisabled is true
    expect(declineBtn).toBeDisabled();
  });

  it('renders meeting link button when meeting_link is set', () => {
    render(
      <InlineInterviewCard
        pendingInterview={{ ...PROPOSED_INTERVIEW, meeting_link: 'https://meet.example.com/abc' }}
        isResponding={false}
        onAccept={vi.fn()}
        onDeclineOpen={vi.fn()}
      />
    );
    // Should find a link/button pointing to the meeting URL
    const joinLink = screen.getAllByRole('link').find(
      (el) => el.getAttribute('href') === 'https://meet.example.com/abc'
    );
    expect(joinLink).toBeDefined();
  });

  it('downloads the .ics through the authenticated client, not a plain link', async () => {
    const { api } = await import('@/lib/api');
    render(
      <InlineInterviewCard
        pendingInterview={PROPOSED_INTERVIEW}
        isResponding={false}
        onAccept={vi.fn()}
        onDeclineOpen={vi.fn()}
      />
    );
    // A plain <a href> to the API sends no sign-in token and answered 401.
    expect(screen.queryAllByRole('link').find((el) => el.getAttribute('href')?.includes('/calendar'))).toBeUndefined();

    const button = screen.getAllByRole('button').find((b) => /download_ics|calendar|\.ics/i.test(b.textContent ?? ''));
    expect(button).toBeDefined();
    fireEvent.click(button!);

    expect(api.download).toHaveBeenCalledWith(
      `/v2/jobs/interviews/${PROPOSED_INTERVIEW.id}/calendar`,
      { filename: 'interview.ics' },
    );
  });

  it('shows in-person location notes with map pin', () => {
    render(
      <InlineInterviewCard
        pendingInterview={{
          ...PROPOSED_INTERVIEW,
          interview_type: 'in_person',
          location_notes: '123 Main St',
        }}
        isResponding={false}
        onAccept={vi.fn()}
        onDeclineOpen={vi.fn()}
      />
    );
    expect(screen.getByText('123 Main St')).toBeInTheDocument();
  });

  // F-298: the employer types both of these; neither may become a link to a
  // non-web scheme in the applicant's browser.
  it('never links the join button to a non-web meeting link', () => {
    render(
      <InlineInterviewCard
        pendingInterview={{ ...PROPOSED_INTERVIEW, meeting_link: 'data:text/html,<script>alert(1)</script>' }}
        isResponding={false}
        onAccept={vi.fn()}
        onDeclineOpen={vi.fn()}
      />
    );
    const hrefs = Array.from(document.querySelectorAll('[href]')).map((el) => el.getAttribute('href'));
    expect(hrefs.some((href) => href?.startsWith('data:'))).toBe(false);
  });

  it('shows non-web video location notes as text, not as a link', () => {
    render(
      <InlineInterviewCard
        pendingInterview={{ ...PROPOSED_INTERVIEW, location_notes: 'file:///etc/passwd' }}
        isResponding={false}
        onAccept={vi.fn()}
        onDeclineOpen={vi.fn()}
      />
    );
    const notes = screen.getByText('file:///etc/passwd');
    expect(notes.closest('a')).toBeNull();
  });

  it('still links a web video location note (control)', () => {
    render(
      <InlineInterviewCard
        pendingInterview={{ ...PROPOSED_INTERVIEW, location_notes: 'https://meet.example.com/xyz' }}
        isResponding={false}
        onAccept={vi.fn()}
        onDeclineOpen={vi.fn()}
      />
    );
    expect(screen.getByText('https://meet.example.com/xyz').closest('a'))
      .toHaveAttribute('href', 'https://meet.example.com/xyz');
  });
});
