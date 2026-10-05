// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The page where the person who reported a safeguarding incident follows it:
 * what they reported, what has happened since in plain words, and a box to add
 * more information while the report is not closed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => (opts && 'id' in opts ? `${key}:${String(opts.id)}` : key) }),
  initReactI18next: { type: '3rdParty', init: () => {} },
  Trans: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useParams: () => ({ id: '7' }),
}));

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/contexts', () => createMockContexts({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { IncidentReportPage } from './IncidentReportPage';
import { api } from '@/lib/api';

const makeReport = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  type: 'concern',
  severity: 'medium',
  status: 'investigating',
  incident_date: '2026-10-01',
  created_at: '2026-10-02 09:00:00',
  organization_id: 3,
  organization_name: 'Food Bank',
  opportunity_id: 9,
  opportunity_title: 'Sorting donations',
  title: 'Left alone on shift',
  description: 'A volunteer was left alone with a client for hours.',
  subject_name: 'Sam Jones',
  can_add: true,
  timeline: [
    { id: 1, type: 'reported', created_at: '2026-10-02 09:00:00' },
    { id: 2, type: 'status_changed', created_at: '2026-10-02 10:00:00', from: 'open', to: 'investigating' },
    { id: 3, type: 'message_to_reporter', created_at: '2026-10-02 11:00:00', body: 'Thank you for telling us.' },
  ],
  ...overrides,
});

function mockReport(report: unknown) {
  vi.mocked(api.get).mockResolvedValue(report === null
    ? { success: false, code: 'NOT_FOUND' }
    : { success: true, data: report });
}

describe('IncidentReportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { event_id: 10 } });
  });

  it('shows the report, its reference and the plain status word', async () => {
    mockReport(makeReport());
    render(<IncidentReportPage />);

    expect(await screen.findByText('Left alone on shift')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/v2/volunteering/incidents/7');
    expect(screen.getByText('safeguarding.report_reference:7')).toBeInTheDocument();
    expect(screen.getByText('safeguarding.member_status.looking_into')).toBeInTheDocument();
    expect(screen.getByText('A volunteer was left alone with a client for hours.')).toBeInTheDocument();
    expect(screen.getByText('Food Bank')).toBeInTheDocument();
  });

  it('lists what has happened, including the team’s message', async () => {
    mockReport(makeReport());
    render(<IncidentReportPage />);

    await screen.findByText('Left alone on shift');
    expect(screen.getByText('safeguarding.timeline_reported')).toBeInTheDocument();
    expect(screen.getByText('safeguarding.timeline_status_changed')).toBeInTheDocument();
    expect(screen.getByText('safeguarding.timeline_message_from_team')).toBeInTheDocument();
    expect(screen.getByText('Thank you for telling us.')).toBeInTheDocument();
  });

  it('adds information and shows it', async () => {
    mockReport(makeReport());
    render(<IncidentReportPage />);
    await screen.findByText('Left alone on shift');

    fireEvent.change(screen.getByLabelText(/safeguarding\.report_add_heading/), { target: { value: 'It happened again on Tuesday evening.' } });
    fireEvent.click(screen.getByRole('button', { name: 'safeguarding.report_add_button' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/v2/volunteering/incidents/7/additions', { body: 'It happened again on Tuesday evening.' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('refuses an addition shorter than 20 characters without sending it', async () => {
    mockReport(makeReport());
    render(<IncidentReportPage />);
    await screen.findByText('Left alone on shift');

    fireEvent.change(screen.getByLabelText(/safeguarding\.report_add_heading/), { target: { value: 'Too short.' } });
    fireEvent.click(screen.getByRole('button', { name: 'safeguarding.report_add_button' }));

    expect(await screen.findByText('safeguarding.report_add_too_short')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('says a closed report cannot be added to and offers a new report', async () => {
    mockReport(makeReport({ status: 'closed', can_add: false }));
    render(<IncidentReportPage />);
    await screen.findByText('Left alone on shift');

    expect(screen.getByText('safeguarding.report_closed_message')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'safeguarding.report_add_button' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'safeguarding.report_make_new' })).toHaveAttribute('href', '/test/volunteering?tab=safeguarding&report=1');
  });

  it('shows a not-found message for a report that is not the member’s', async () => {
    mockReport(null);
    render(<IncidentReportPage />);

    expect(await screen.findByText('safeguarding.report_not_found')).toBeInTheDocument();
  });
});
