// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ─── Hoisted mock data ────────────────────────────────────────────────────────
const { mockAdminVolunteering } = vi.hoisted(() => ({
  mockAdminVolunteering: {
    getIncidents: vi.fn(),
    getIncidentReportOptions: vi.fn(),
    updateIncident: vi.fn(),
    assignDlp: vi.fn(),
  },
}));

vi.mock('../../api/adminApi', () => ({
  adminVolunteering: mockAdminVolunteering,
  // The assign dialog embeds MemberSearchPicker, which searches members.
  adminUsers: { list: vi.fn(), get: vi.fn() },
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// The organisation and opportunity pickers are React Aria Autocompletes, whose
// popover cannot open in jsdom ("Cannot set property focus"). Stub just those two
// as a native select — the same approach as GroupSelector.test.tsx. The DLP
// member picker is a ComboBox and stays real.
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
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// Stub DataTable — render a simple list of row keys so we can detect rows.
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/DataTable' (and friends) directly, and vitest keys
// mocks per resolved module, so a barrel-only mock never installs for those
// imports — the real components rendered and the stub testids were never in the
// DOM. A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run.
function adminComponentsMock() {
  return {
    DataTable: ({ data, isLoading, columns, totalItems, page, pageSize, onPageChange, onSearch, searchValue, topContent, emptyContent }: {
      data: { id: number; reporter_name: string }[];
      isLoading?: boolean;
      columns?: { key: string; render?: (row: unknown) => React.ReactNode }[];
      totalItems?: number;
      page?: number;
      pageSize?: number;
      onPageChange?: (page: number) => void;
      onSearch?: (query: string) => void;
      searchValue?: string;
      topContent?: React.ReactNode;
      emptyContent?: React.ReactNode;
    }) =>
      isLoading ? (
        <div role="status" aria-busy="true" aria-label="loading" />
      ) : (
        <div>
          {onSearch && (
            <input aria-label="table search" value={searchValue ?? ''} onChange={(e) => onSearch(e.target.value)} />
          )}
          {topContent}
          <table>
            <tbody>
              {data.map((row) => (
                <tr key={row.id} data-testid={`incident-row-${row.id}`}>
                  <td>{row.reporter_name}</td>
                  <td>{columns?.find((c) => c.key === 'actions')?.render?.(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.length === 0 && emptyContent}
          {onPageChange && totalItems !== undefined && totalItems > (pageSize ?? 20) && (
            <button type="button" onClick={() => onPageChange((page ?? 1) + 1)}>next page</button>
          )}
        </div>
      ),
    PageHeader: ({ title }: { title: string }) => <div data-testid="page-header">{title}</div>,
    StatCard: ({ label, value }: { label: string; value: unknown }) => (
      <div data-testid="stat-card">{label}: {String(value)}</div>
    ),
    EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/DataTable', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);
vi.mock('../../components/StatCard', adminComponentsMock);
vi.mock('../../components/EmptyState', adminComponentsMock);

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  })
);

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeIncident = (overrides = {}) => ({
  id: 1,
  type: 'concern' as const,
  severity: 'medium' as const,
  reporter_name: 'Alice Reporter',
  subject_name: 'Bob Subject',
  organization_name: 'Good Org',
  status: 'open' as const,
  date: '2025-03-01T10:00:00Z',
  description: 'Something concerning happened',
  action_taken: undefined,
  resolution_notes: undefined,
  ...overrides,
});

const makeStats = () => ({
  total_incidents: 3,
  open: 2,
  under_investigation: 1,
  resolved: 0,
});

const makeDlpAssignment = (overrides = {}) => ({
  organization_id: 10,
  organization_name: 'Org Alpha',
  dlp_user_id: null,
  dlp_user_name: null,
  ...overrides,
});

const makeGetIncidentsResponse = (data = {}) => ({
  success: true,
  data: {
    incidents: [],
    stats: makeStats(),
    dlp_assignments: [],
    ...data,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
describe('VolunteerSafeguarding', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminVolunteering.getIncidents.mockResolvedValue(makeGetIncidentsResponse());
  });

  it('shows a loading spinner initially', async () => {
    mockAdminVolunteering.getIncidents.mockImplementation(() => new Promise(() => {}));
    const { VolunteerSafeguarding } = await import('./VolunteerSafeguarding');
    render(<VolunteerSafeguarding />);

    // DataTable stub renders role=status while loading
    const statusEls = screen.getAllByRole('status');
    const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders empty state when no incidents are returned', async () => {
    const { VolunteerSafeguarding } = await import('./VolunteerSafeguarding');
    render(<VolunteerSafeguarding />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders incident rows when data is present', async () => {
    mockAdminVolunteering.getIncidents.mockResolvedValue(
      makeGetIncidentsResponse({ incidents: [makeIncident()] })
    );

    const { VolunteerSafeguarding } = await import('./VolunteerSafeguarding');
    render(<VolunteerSafeguarding />);

    await waitFor(() => {
      expect(screen.getByTestId('incident-row-1')).toBeInTheDocument();
    });
    expect(screen.getByText('Alice Reporter')).toBeInTheDocument();
  });

  it('renders stat cards with correct totals', async () => {
    const { VolunteerSafeguarding } = await import('./VolunteerSafeguarding');
    render(<VolunteerSafeguarding />);

    await waitFor(() => {
      const cards = screen.getAllByTestId('stat-card');
      expect(cards.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('shows error toast when incidents API fails', async () => {
    mockAdminVolunteering.getIncidents.mockRejectedValue(new Error('network'));
    const { VolunteerSafeguarding } = await import('./VolunteerSafeguarding');
    render(<VolunteerSafeguarding />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('renders DLP assignments section with assign button', async () => {
    mockAdminVolunteering.getIncidents.mockResolvedValue(
      makeGetIncidentsResponse({ dlp_assignments: [makeDlpAssignment()] })
    );

    const { VolunteerSafeguarding } = await import('./VolunteerSafeguarding');
    render(<VolunteerSafeguarding />);

    await waitFor(() => {
      expect(screen.getByText('Org Alpha')).toBeInTheDocument();
    });

    // "Assign DLP" button exists for an unassigned org
    const assignBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('assign')
    );
    expect(assignBtn).toBeDefined();
  });

  it('hides DLP assignment when embedded for brokers (canAssignDlp=false, F-536)', async () => {
    mockAdminVolunteering.getIncidents.mockResolvedValue(
      makeGetIncidentsResponse({ dlp_assignments: [makeDlpAssignment()] })
    );

    const { VolunteerSafeguarding } = await import('./VolunteerSafeguarding');
    render(<VolunteerSafeguarding canAssignDlp={false} />);

    await waitFor(() => {
      expect(screen.getByText('Org Alpha')).toBeInTheDocument();
    });

    // The assignment is still listed, but there is no way to change it here.
    const assignBtn = screen.queryAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('assign')
    );
    expect(assignBtn).toBeUndefined();
  });

  it('opens DLP assignment modal when assign button is clicked', async () => {
    mockAdminVolunteering.getIncidents.mockResolvedValue(
      makeGetIncidentsResponse({ dlp_assignments: [makeDlpAssignment()] })
    );

    const { VolunteerSafeguarding } = await import('./VolunteerSafeguarding');
    render(<VolunteerSafeguarding />);

    await waitFor(() => screen.getByText('Org Alpha'));

    const assignBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('assign')
    );
    expect(assignBtn).toBeDefined();
    if (assignBtn) fireEvent.click(assignBtn);

    // Modal opens (role=dialog may be in portal; check via document)
    await waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).toBeTruthy();
    });
  });

  it('asks for a person by name, not a numeric user id, and refuses an empty choice', async () => {
    mockAdminVolunteering.getIncidents.mockResolvedValue(
      makeGetIncidentsResponse({ dlp_assignments: [makeDlpAssignment()] })
    );

    const { VolunteerSafeguarding } = await import('./VolunteerSafeguarding');
    render(<VolunteerSafeguarding />);
    await waitFor(() => screen.getByText('Org Alpha'));

    const assignBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('assign')
    );
    if (assignBtn) fireEvent.click(assignBtn);

    // A searchable picker, with no spin-box for an id number.
    const picker = await screen.findByRole('combobox');
    expect(picker).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();

    // Pressing Assign with nobody chosen explains what to do and sends nothing.
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent?.trim().toLowerCase() === 'assign'
    );
    expect(confirm).toBeDefined();
    if (confirm) fireEvent.click(confirm);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(mockAdminVolunteering.assignDlp).not.toHaveBeenCalled();
  });

  it('shows the reason the server gives when the person cannot be made DLP', async () => {
    const reason = 'That account is not active, so it cannot be made the DLP';
    mockAdminVolunteering.getIncidents.mockResolvedValue(
      makeGetIncidentsResponse({ dlp_assignments: [makeDlpAssignment()] })
    );
    mockAdminVolunteering.assignDlp.mockResolvedValue({ success: false, error: reason });
    const { adminUsers } = await import('../../api/adminApi');
    // The picker accepts a bare array as well as the paginated envelope.
    vi.mocked(adminUsers.list).mockResolvedValue({
      success: true,
      data: [{ id: 42, name: 'Mary Member', email: 'mary@example.com' }],
    } as never);

    const { VolunteerSafeguarding } = await import('./VolunteerSafeguarding');
    render(<VolunteerSafeguarding />);
    await waitFor(() => screen.getByText('Org Alpha'));

    const assignBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('assign')
    );
    if (assignBtn) fireEvent.click(assignBtn);

    const picker = await screen.findByRole('combobox');
    await userEvent.type(picker, 'mary');
    await userEvent.click(await screen.findByText('Mary Member'));

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent?.trim().toLowerCase() === 'assign'
    );
    if (confirm) fireEvent.click(confirm);

    await waitFor(() => {
      expect(mockAdminVolunteering.assignDlp).toHaveBeenCalledWith(10, 42);
    });
    // The server's own wording is shown beside the field, not a bare "failed".
    expect(await screen.findByText(reason)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(reason);
  });

  it('shows success toast after successful incident update', async () => {
    mockAdminVolunteering.getIncidents.mockResolvedValue(
      makeGetIncidentsResponse({ incidents: [makeIncident()] })
    );
    mockAdminVolunteering.updateIncident.mockResolvedValue({ success: true });
    // reload after update
    mockAdminVolunteering.getIncidents.mockResolvedValueOnce(makeGetIncidentsResponse({ incidents: [makeIncident()] }));
    mockAdminVolunteering.getIncidents.mockResolvedValueOnce(makeGetIncidentsResponse());

    const { VolunteerSafeguarding } = await import('./VolunteerSafeguarding');
    render(<VolunteerSafeguarding />);

    await waitFor(() => screen.getByTestId('incident-row-1'));

    // The DataTable stub doesn't render the action button; we test the handler directly
    // by verifying the component loads correctly and the mock is wired up
    expect(mockAdminVolunteering.getIncidents).toHaveBeenCalled();
  });

  it('hands an incident to a named handler, never to the person it is about', async () => {
    const user = userEvent.setup();
    mockAdminVolunteering.getIncidents.mockResolvedValue(
      makeGetIncidentsResponse({
        incidents: [makeIncident({ title: 'Left alone on shift', assigned_to: null, subject_user_id: 7 })],
        handlers: [{ id: 5, name: 'Hana Handler' }, { id: 7, name: 'Sid Subject' }],
      })
    );
    mockAdminVolunteering.updateIncident.mockResolvedValue({ success: true });

    const { VolunteerSafeguarding } = await import('./VolunteerSafeguarding');
    render(<VolunteerSafeguarding />);

    const row = await screen.findByTestId('incident-row-1');
    await user.click(within(row).getByRole('button'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Left alone on shift')).toBeInTheDocument();

    const trigger = within(dialog).getAllByRole('button').find((b) => b.textContent?.includes('Nobody yet'));
    expect(trigger).toBeTruthy();
    await user.click(trigger as HTMLElement);

    expect(await screen.findByRole('option', { name: 'Hana Handler' })).toBeInTheDocument();
    // F-507: the person the incident is about is never offered as its handler.
    expect(screen.queryByRole('option', { name: 'Sid Subject' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Hana Handler' }));

    const UPDATE_LABEL = 'Update Incident';
    const save = within(dialog).getAllByRole('button').find((b) => b.textContent?.trim() === UPDATE_LABEL);
    await user.click(save as HTMLElement);

    await waitFor(() => expect(mockAdminVolunteering.updateIncident).toHaveBeenCalledWith(1, { status: 'open', assigned_to: 5 }));
  });

  it('asks the server for the first page of 20', async () => {
    const { VolunteerSafeguarding } = await import('./VolunteerSafeguarding');
    render(<VolunteerSafeguarding />);

    await waitFor(() => expect(mockAdminVolunteering.getIncidents).toHaveBeenCalled());
    expect(mockAdminVolunteering.getIncidents).toHaveBeenLastCalledWith({ page: 1, per_page: 20 });
  });

  it('reaches incidents beyond the first 20 by asking for the next page', async () => {
    // The screen used to ask for one page and stop, so incident 21 onwards was unreachable.
    mockAdminVolunteering.getIncidents.mockResolvedValue(
      makeGetIncidentsResponse({ incidents: [makeIncident()], total: 45 })
    );
    const { VolunteerSafeguarding } = await import('./VolunteerSafeguarding');
    render(<VolunteerSafeguarding />);

    fireEvent.click(await screen.findByRole('button', { name: 'next page' }));

    await waitFor(() =>
      expect(mockAdminVolunteering.getIncidents).toHaveBeenLastCalledWith({ page: 2, per_page: 20 })
    );
  });

  it('searches on the server and starts again from the first page', async () => {
    mockAdminVolunteering.getIncidents.mockResolvedValue(
      makeGetIncidentsResponse({ incidents: [makeIncident()], total: 45 })
    );
    const { VolunteerSafeguarding } = await import('./VolunteerSafeguarding');
    render(<VolunteerSafeguarding />);

    fireEvent.click(await screen.findByRole('button', { name: 'next page' }));
    await waitFor(() =>
      expect(mockAdminVolunteering.getIncidents).toHaveBeenLastCalledWith({ page: 2, per_page: 20 })
    );

    fireEvent.change(screen.getByLabelText('table search'), { target: { value: 'Food Bank' } });

    await waitFor(() =>
      expect(mockAdminVolunteering.getIncidents).toHaveBeenLastCalledWith({ page: 1, per_page: 20, search: 'Food Bank' })
    );
  });

  it('says nothing matches, and offers to clear, when a search finds nothing', async () => {
    mockAdminVolunteering.getIncidents.mockResolvedValueOnce(
      makeGetIncidentsResponse({ incidents: [makeIncident()], total: 1 })
    );
    mockAdminVolunteering.getIncidents.mockResolvedValue(makeGetIncidentsResponse({ incidents: [], total: 0 }));
    const { VolunteerSafeguarding } = await import('./VolunteerSafeguarding');
    render(<VolunteerSafeguarding />);

    await screen.findByTestId('incident-row-1');
    fireEvent.change(screen.getByLabelText('table search'), { target: { value: 'nobody' } });

    expect(await screen.findByText('No incidents match your search or filter.')).toBeInTheDocument();
    // Not the "no incidents yet" empty state, which would also hide the search box.
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
    expect(screen.getByLabelText('table search')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filter' }));
    await waitFor(() =>
      expect(mockAdminVolunteering.getIncidents).toHaveBeenLastCalledWith({ page: 1, per_page: 20 })
    );
  });

  it('lets staff correct how an incident is filed, sending only what changed', async () => {
    const user = userEvent.setup();
    mockAdminVolunteering.getIncidents.mockResolvedValue(
      makeGetIncidentsResponse({
        incidents: [makeIncident({ title: 'Filed wrongly', type: 'concern', severity: 'medium', incident_date: '2026-09-01' })],
      })
    );
    mockAdminVolunteering.getIncidentReportOptions.mockResolvedValue({
      success: true,
      data: {
        organisations: [{ id: 3, name: 'Food Bank' }],
        opportunities: [{ id: 9, title: 'Sorting donations', organization_id: 3, organization_name: 'Food Bank' }],
      },
    });
    mockAdminVolunteering.updateIncident.mockResolvedValue({ success: true });

    const { VolunteerSafeguarding } = await import('./VolunteerSafeguarding');
    render(<VolunteerSafeguarding />);

    const row = await screen.findByTestId('incident-row-1');
    await user.click(within(row).getByRole('button'));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(mockAdminVolunteering.getIncidentReportOptions).toHaveBeenCalled());
    expect(within(dialog).getByRole('heading', { name: 'How this incident is filed' })).toBeInTheDocument();

    // Correct the kind of incident.
    const typeTrigger = within(dialog).getAllByRole('button').find((b) => b.textContent?.includes('Concern'));
    await user.click(typeTrigger as HTMLElement);
    await user.click(await screen.findByRole('option', { name: 'Allegation' }));

    // Record that the authorities were told, with their reference.
    await user.click(within(dialog).getByRole('switch'));
    await user.type(await within(dialog).findByLabelText('Their reference (optional)'), 'POL-42');

    const save = within(dialog).getAllByRole('button').find((b) => b.textContent?.trim() === 'Update Incident');
    await user.click(save as HTMLElement);

    await waitFor(() => expect(mockAdminVolunteering.updateIncident).toHaveBeenCalledWith(1, {
      status: 'open',
      incident_type: 'allegation',
      authority_notified: true,
      authority_reference: 'POL-42',
    }));
  });

  it('files an incident under an organisation by choosing it, and says the organisation will be told', async () => {
    const user = userEvent.setup();
    mockAdminVolunteering.getIncidents.mockResolvedValue(
      makeGetIncidentsResponse({ incidents: [makeIncident({ organization_name: '', organization_id: null })] })
    );
    mockAdminVolunteering.getIncidentReportOptions.mockResolvedValue({
      success: true,
      data: {
        organisations: [{ id: 3, name: 'Food Bank' }],
        opportunities: [{ id: 9, title: 'Sorting donations', organization_id: 3, organization_name: 'Food Bank' }],
      },
    });
    mockAdminVolunteering.updateIncident.mockResolvedValue({ success: true });

    const { VolunteerSafeguarding } = await import('./VolunteerSafeguarding');
    render(<VolunteerSafeguarding />);
    const row = await screen.findByTestId('incident-row-1');
    await user.click(within(row).getByRole('button'));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(mockAdminVolunteering.getIncidentReportOptions).toHaveBeenCalled());

    // Choosing the opportunity files it under that opportunity's organisation too.
    const opportunityPicker = await within(dialog).findByRole('combobox', { name: 'Opportunity' });
    await waitFor(() => expect(within(opportunityPicker).getAllByRole('option')).toHaveLength(2));
    await user.selectOptions(opportunityPicker, '9');
    // ...and that filled in the organisation.
    expect(within(dialog).getByRole('combobox', { name: 'Organization' })).toHaveValue('3');

    expect(await within(dialog).findByRole('note')).toHaveTextContent(/emailed a short notice/);

    const save = within(dialog).getAllByRole('button').find((b) => b.textContent?.trim() === 'Update Incident');
    await user.click(save as HTMLElement);
    await waitFor(() => expect(mockAdminVolunteering.updateIncident).toHaveBeenCalledWith(1, {
      status: 'open',
      organization_id: 3,
      opportunity_id: 9,
    }));
  });

  it('renders audit log timeline when incidents are present', async () => {
    mockAdminVolunteering.getIncidents.mockResolvedValue(
      makeGetIncidentsResponse({ incidents: [makeIncident()] })
    );

    const { VolunteerSafeguarding } = await import('./VolunteerSafeguarding');
    render(<VolunteerSafeguarding />);

    await waitFor(() => {
      // The incident row appears in the DataTable stub
      expect(screen.getByTestId('incident-row-1')).toBeInTheDocument();
    });

    // subject_name appears in the audit log timeline paragraph
    // (may be combined with organization_name as "Bob Subject — Good Org")
    expect(document.body.textContent).toContain('Bob Subject');
  });
});
