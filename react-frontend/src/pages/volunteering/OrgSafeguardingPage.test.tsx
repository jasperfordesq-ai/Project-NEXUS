// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * An organisation's safeguarding reports, for its owner, administrators and
 * safeguarding lead: a summary of each report linked to it, the full report only
 * once the community's team shares it with the lead, and never who reported it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => (opts && 'id' in opts ? `${key}:${String(opts.id)}` : key) }),
  initReactI18next: { type: '3rdParty', init: () => {} },
  Trans: ({ children }: { children: React.ReactNode }) => children,
}));

const params: { orgId?: string; id?: string } = {};
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useParams: () => params,
}));

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/contexts', () => createMockContexts({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { OrgSafeguardingPage } from './OrgSafeguardingPage';
import { api } from '@/lib/api';
import { usePageTitle } from '@/hooks/usePageTitle';

const summary = (overrides: Record<string, unknown> = {}) => ({
  id: 12,
  type: 'allegation',
  severity: 'high',
  status: 'investigating',
  incident_date: '2026-10-01',
  created_at: '2026-10-02 09:00:00',
  organization_id: 3,
  organization_name: 'Food Bank',
  opportunity_id: 9,
  opportunity_title: 'Sorting donations',
  full_report_shared: false,
  ...overrides,
});

const detail = (overrides: Record<string, unknown> = {}) => ({
  ...summary(),
  relation: 'org_contact',
  timeline: [
    { id: 1, type: 'reported', created_at: '2026-10-02 09:00:00' },
    { id: 2, type: 'message_to_organisation', created_at: '2026-10-02 10:00:00', body: 'Please call the team.' },
    { id: 3, type: 'org_update', created_at: '2026-10-02 11:00:00', body: 'We have stood the volunteer down.', actor_name: 'Olive Owner' },
  ],
  ...overrides,
});

describe('OrgSafeguardingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete params.id;
    params.orgId = '3';
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { event_id: 20 } });
  });

  it('lists the reports linked to the organisation, with reference, kind, seriousness and plain status', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { items: [summary(), summary({ id: 13, full_report_shared: true })], relation: 'org_lead' } });
    render(<OrgSafeguardingPage />);

    const row = await screen.findByRole('link', { name: /#12/ });
    expect(api.get).toHaveBeenCalledWith('/v2/volunteering/organisations/3/incidents');
    expect(row).toHaveAttribute('href', '/test/volunteering/org/3/safeguarding/12');
    expect(screen.getAllByText('safeguarding.incident_types.allegation').length).toBeGreaterThan(0);
    expect(screen.getAllByText('safeguarding.severity_options.high').length).toBeGreaterThan(0);
    expect(screen.getAllByText('safeguarding.member_status.looking_into').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sorting donations').length).toBeGreaterThan(0);
    // Only the report shared with the lead is marked as shared.
    expect(screen.getAllByText('org_safeguarding.shared_chip')).toHaveLength(1);
  });

  it('says so, and shows nothing, when the member has no part in the organisation', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false, code: 'NOT_ORGANISATION_CONTACT' });
    render(<OrgSafeguardingPage />);

    expect(await screen.findByText('org_safeguarding.forbidden')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /#\d+/ })).not.toBeInTheDocument();
  });

  it('shows the summary without the report when it has not been shared', async () => {
    params.id = '12';
    vi.mocked(api.get).mockResolvedValue({ success: true, data: detail() });
    render(<OrgSafeguardingPage />);

    expect(await screen.findByText('org_safeguarding.reference:12')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/v2/volunteering/organisations/3/incidents/12');
    expect(screen.getByText('org_safeguarding.team_handling')).toBeInTheDocument();
    expect(screen.queryByText('org_safeguarding.full_report_heading')).not.toBeInTheDocument();
    expect(screen.getByText('Please call the team.')).toBeInTheDocument();
    expect(screen.getByText('We have stood the volunteer down.')).toBeInTheDocument();
  });

  it('shows the full report and the reporter’s additions once shared — but never who reported it', async () => {
    params.id = '12';
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: detail({
        relation: 'org_lead',
        full_report_shared: true,
        title: 'Left alone on shift',
        description: 'A volunteer was left alone with a client.',
        subject_name: 'Sid Subject',
        // Defence in depth: even if the API sent these, the page must not show them.
        reporter_name: 'Rita Reporter',
        reported_by: 40,
        timeline: [
          { id: 1, type: 'reported', created_at: '2026-10-02 09:00:00' },
          { id: 4, type: 'reporter_addition', created_at: '2026-10-02 12:00:00', body: 'It happened again on Tuesday.' },
        ],
      }),
    });
    render(<OrgSafeguardingPage />);

    expect(await screen.findByText('org_safeguarding.full_report_heading')).toBeInTheDocument();
    expect(screen.getByText('Left alone on shift')).toBeInTheDocument();
    expect(screen.getByText('A volunteer was left alone with a client.')).toBeInTheDocument();
    expect(screen.getByText('Sid Subject')).toBeInTheDocument();
    expect(screen.getByText('It happened again on Tuesday.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Rita Reporter');
  });

  it('sends an update from the organisation and reloads', async () => {
    params.id = '12';
    vi.mocked(api.get).mockResolvedValue({ success: true, data: detail() });
    render(<OrgSafeguardingPage />);
    await screen.findByText('org_safeguarding.reference:12');

    fireEvent.change(screen.getByLabelText(/org_safeguarding\.update_label/), { target: { value: 'We have spoken to the volunteer today.' } });
    fireEvent.click(screen.getByRole('button', { name: 'org_safeguarding.update_send' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/v2/volunteering/organisations/3/incidents/12/updates', { body: 'We have spoken to the volunteer today.' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('refuses an update shorter than 20 characters', async () => {
    params.id = '12';
    vi.mocked(api.get).mockResolvedValue({ success: true, data: detail() });
    render(<OrgSafeguardingPage />);
    await screen.findByText('org_safeguarding.reference:12');

    fireEvent.change(screen.getByLabelText(/org_safeguarding\.update_label/), { target: { value: 'Too short.' } });
    fireEvent.click(screen.getByRole('button', { name: 'org_safeguarding.update_send' }));

    expect(await screen.findByText('org_safeguarding.update_too_short')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('works as a dashboard tab for the organisation it is given', async () => {
    params.orgId = undefined;
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { items: [], relation: 'org_contact' } });
    render(<OrgSafeguardingPage embedded orgId={5} />);

    expect(await screen.findByText('org_safeguarding.empty')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/v2/volunteering/organisations/5/incidents');
    expect(within(document.body).queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    // Inside the dashboard the dashboard keeps its own browser-tab title.
    expect(vi.mocked(usePageTitle)).not.toHaveBeenCalled();
  });
});
