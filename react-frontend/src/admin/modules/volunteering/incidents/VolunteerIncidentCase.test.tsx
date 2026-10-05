// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

const { mockAdminVolunteering } = vi.hoisted(() => ({
  mockAdminVolunteering: {
    getIncidentCase: vi.fn(),
    updateIncident: vi.fn(),
    addIncidentNote: vi.fn(),
    sendIncidentMessage: vi.fn(),
    shareIncident: vi.fn(),
    withdrawIncidentShare: vi.fn(),
    getIncidentReportOptions: vi.fn(),
  },
}));

vi.mock('../../../api/adminApi', () => ({ adminVolunteering: mockAdminVolunteering }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// React Aria Autocompletes cannot open in jsdom; stub them as a native select
// (same approach as GroupSelector.test.tsx).
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    Autocomplete: ({ label, placeholder, value, onChange, children }: {
      label?: string;
      placeholder?: string;
      value?: string | null;
      onChange?: (key: string | null) => void;
      children?: React.ReactNode;
    }) => (
      <select aria-label={label} value={value ?? ''} onChange={(e) => onChange?.(e.target.value || null)}>
        <option value="">{placeholder}</option>
        {children}
      </select>
    ),
    AutocompleteItem: ({ id, children }: { id?: string; children?: React.ReactNode }) => (
      <option value={id}>{typeof children === 'string' ? children : id}</option>
    ),
  };
});

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('@/contexts', () => createMockContexts({ useToast: () => mockToast }));

const makeCase = (overrides: Record<string, unknown> = {}) => ({
  id: 12,
  type: 'concern',
  severity: 'high',
  status: 'open',
  incident_date: '2026-09-30',
  created_at: '2026-10-01 09:00:00',
  organization_id: 3,
  organization_name: 'Food Bank',
  opportunity_id: 9,
  opportunity_title: 'Sorting donations',
  title: 'Left alone on shift',
  description: 'A volunteer was left alone with a client.',
  category: 'general',
  reported_by: 40,
  reporter_name: 'Alice Reporter',
  subject_user_id: 7,
  involved_user_id: null,
  subject_name: 'Sid Subject',
  assigned_to: null,
  assigned_to_name: null,
  authority_notified: false,
  authority_reference: null,
  share: null,
  timeline: [
    { id: 1, type: 'reported', created_at: '2026-10-01 09:00:00', actor_name: 'Alice Reporter' },
    { id: 2, type: 'staff_note', created_at: '2026-10-01 10:00:00', actor_name: 'Hana Handler', body: 'Called the organisation.' },
    { id: 3, type: 'message_to_reporter', created_at: '2026-10-01 11:00:00', actor_name: 'Hana Handler', body: 'Thank you for telling us.' },
  ],
  handlers: [{ id: 5, name: 'Hana Handler' }, { id: 7, name: 'Sid Subject' }],
  organisation_leads: [],
  ...overrides,
});

async function renderCase(overrides: Record<string, unknown> = {}) {
  mockAdminVolunteering.getIncidentCase.mockResolvedValue({ success: true, data: makeCase(overrides) });
  const { VolunteerIncidentCase } = await import('./VolunteerIncidentCase');
  render(<VolunteerIncidentCase incidentId={12} backPath="/admin/volunteering/safeguarding" />);
  await screen.findByRole('heading', { name: 'Left alone on shift' });
}

const button = (name: string) => screen.getByRole('button', { name });

describe('VolunteerIncidentCase', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminVolunteering.getIncidentReportOptions.mockResolvedValue({
      success: true,
      data: {
        organisations: [{ id: 3, name: 'Food Bank' }, { id: 4, name: 'Book Club' }],
        opportunities: [{ id: 9, title: 'Sorting donations', organization_id: 3, organization_name: 'Food Bank' }],
      },
    });
    for (const fn of ['updateIncident', 'addIncidentNote', 'sendIncidentMessage', 'shareIncident', 'withdrawIncidentShare'] as const) {
      mockAdminVolunteering[fn].mockResolvedValue({ success: true });
    }
  });

  it('shows the reference, title, status and the report with reporter and subject', async () => {
    await renderCase();

    expect(screen.getByText('Incident #12')).toBeInTheDocument();
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0);
    expect(screen.getByText('A volunteer was left alone with a client.')).toBeInTheDocument();
    expect(screen.getByText('Alice Reporter', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText('Sid Subject', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to incidents' })).toHaveAttribute('href', '/test/admin/volunteering/safeguarding');
  });

  it('will not resolve without a reason, and sends the reason when given', async () => {
    const user = userEvent.setup();
    await renderCase();

    await user.click(screen.getAllByRole('button').find((b) => b.textContent?.includes('Open') && b.getAttribute('aria-haspopup')) as HTMLElement);
    await user.click(await screen.findByRole('option', { name: 'Resolved' }));
    await user.click(button('Save status'));

    expect(await screen.findByText('Say why before you resolve, escalate or close this incident.')).toBeInTheDocument();
    expect(mockAdminVolunteering.updateIncident).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Why (seen by the team only)'), 'Volunteer stood down.');
    await user.click(button('Save status'));
    await waitFor(() => expect(mockAdminVolunteering.updateIncident).toHaveBeenCalledWith(12, { status: 'resolved', reason: 'Volunteer stood down.' }));
  });

  it('shows the server reason beside the section when a save is refused', async () => {
    const user = userEvent.setup();
    mockAdminVolunteering.updateIncident.mockResolvedValue({ success: false, error: 'That value cannot be used here.', errors: [{ field: 'status' }] });
    await renderCase();

    await user.click(screen.getAllByRole('button').find((b) => b.textContent?.includes('Open') && b.getAttribute('aria-haspopup')) as HTMLElement);
    await user.click(await screen.findByRole('option', { name: 'Under investigation' }));
    await user.click(button('Save status'));

    expect(await screen.findByRole('alert')).toHaveTextContent('That value cannot be used here.');
  });

  it('hands the incident to a named handler, never to the person it is about', async () => {
    const user = userEvent.setup();
    await renderCase();

    const trigger = screen.getAllByRole('button').find((b) => b.textContent?.includes('Nobody yet'));
    await user.click(trigger as HTMLElement);
    expect(await screen.findByRole('option', { name: 'Hana Handler' })).toBeInTheDocument();
    // F-507: the person the incident is about is never offered as its handler.
    expect(screen.queryByRole('option', { name: 'Sid Subject' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Hana Handler' }));
    await user.click(button('Save handler'));

    await waitFor(() => expect(mockAdminVolunteering.updateIncident).toHaveBeenCalledWith(12, { assigned_to: 5 }));
  });

  it('refiles under another organisation, sending only what changed, and says the organisation will be told', async () => {
    const user = userEvent.setup();
    await renderCase();
    await waitFor(() => expect(mockAdminVolunteering.getIncidentReportOptions).toHaveBeenCalled());

    const org = await screen.findByRole('combobox', { name: 'Organization' });
    await waitFor(() => expect(within(org).getAllByRole('option')).toHaveLength(3));
    await user.selectOptions(org, '4');
    expect(await screen.findByRole('note')).toHaveTextContent(/emailed a short notice/);
    await user.click(button('Save filing'));

    await waitFor(() => expect(mockAdminVolunteering.updateIncident).toHaveBeenCalledWith(12, { organization_id: 4, opportunity_id: null }));
  });

  it('records that the authorities were told, with their reference', async () => {
    const user = userEvent.setup();
    await renderCase();

    await user.click(screen.getByRole('switch'));
    await user.type(await screen.findByLabelText('Their reference (optional)'), 'POL-42');
    await user.click(button('Save'));

    await waitFor(() => expect(mockAdminVolunteering.updateIncident).toHaveBeenCalledWith(12, { authority_notified: true, authority_reference: 'POL-42' }));
  });

  it('adds a note for the team and reloads the case', async () => {
    const user = userEvent.setup();
    await renderCase();

    await user.type(screen.getByLabelText('Add a note for the team'), '  Rang the volunteer.  ');
    await user.click(button('Add note'));

    await waitFor(() => expect(mockAdminVolunteering.addIncidentNote).toHaveBeenCalledWith(12, 'Rang the volunteer.'));
    await waitFor(() => expect(mockAdminVolunteering.getIncidentCase).toHaveBeenCalledTimes(2));
  });

  it('messages the reporter, and cannot message an organisation when there is none', async () => {
    const user = userEvent.setup();
    await renderCase({ organization_id: null, organization_name: null, opportunity_id: null, opportunity_title: null });

    expect(screen.getByText(/so you can only message the person who reported it/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Message'), 'We are looking into it.');
    await user.click(button('Send message'));

    await waitFor(() => expect(mockAdminVolunteering.sendIncidentMessage).toHaveBeenCalledWith(12, 'reporter', 'We are looking into it.'));
    expect(screen.getByText('Link this incident to an organisation before sharing it.')).toBeInTheDocument();
  });

  it('cannot share the full report when the organisation has no safeguarding lead', async () => {
    await renderCase();

    expect(screen.getByText(/has no safeguarding lead yet/)).toBeInTheDocument();
    expect(button('Share full report')).toBeDisabled();
  });

  it('names the leads, shares with them, and can stop sharing', async () => {
    const user = userEvent.setup();
    await renderCase({ organisation_leads: [{ id: 20, name: 'Lena Lead' }, { id: 21, name: 'Dev Deputy' }] });

    expect(screen.getByText('It will go to: Lena Lead, Dev Deputy')).toBeInTheDocument();
    await user.click(button('Share full report'));
    await waitFor(() => expect(mockAdminVolunteering.shareIncident).toHaveBeenCalledWith(12));
  });

  it('can stop sharing a report that is shared', async () => {
    const user = userEvent.setup();
    await renderCase({ share: { organization_id: 3, shared_at: '2026-10-02 08:00:00' }, organisation_leads: [{ id: 20, name: 'Lena Lead' }] });

    await user.click(button('Stop sharing'));
    await waitFor(() => expect(mockAdminVolunteering.withdrawIncidentShare).toHaveBeenCalledWith(12));
  });

  it('lists the history newest first and filters it to notes', async () => {
    const user = userEvent.setup();
    await renderCase();

    const timeline = screen.getByTestId('incident-timeline');
    const types = within(timeline).getAllByRole('listitem').map((li) => li.getAttribute('data-event-type'));
    expect(types).toEqual(['message_to_reporter', 'staff_note', 'reported']);

    await user.click(button('Notes'));
    const filtered = within(screen.getByTestId('incident-timeline')).getAllByRole('listitem');
    expect(filtered.map((li) => li.getAttribute('data-event-type'))).toEqual(['staff_note']);
    expect(filtered[0]).toHaveTextContent('Called the organisation.');
  });

  it('says so when the incident cannot be found', async () => {
    mockAdminVolunteering.getIncidentCase.mockResolvedValue({ success: false, code: 'NOT_FOUND' });
    const { VolunteerIncidentCase } = await import('./VolunteerIncidentCase');
    render(<VolunteerIncidentCase incidentId={99} backPath="/admin/volunteering/safeguarding" />);

    expect(await screen.findByText(/This incident could not be found/)).toBeInTheDocument();
  });

  it('never puts the free-text title of a report in the browser tab', async () => {
    const { usePageTitle } = await import('@/hooks');
    await renderCase();

    expect(vi.mocked(usePageTitle)).toHaveBeenCalledWith(expect.stringContaining('#12'));
    expect(vi.mocked(usePageTitle)).not.toHaveBeenCalledWith(expect.stringContaining('Left alone on shift'));
  });

});
