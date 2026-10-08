// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));

let mockVolunteeringConfig: Record<string, unknown> = {};

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()), dispatch: jest.fn() }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'volunteeringVolunteer:incident.title': 'Report a concern',
        'volunteeringVolunteer:incident.intro': 'Tell your community safeguarding lead about something that worried you.',
        'volunteeringVolunteer:incident.emergency': 'If someone is in immediate danger, call your local emergency number now. This form is not watched around the clock.',
        'volunteeringVolunteer:incident.titleLabel': 'Title',
        'volunteeringVolunteer:incident.titlePlaceholder': 'A short summary',
        'volunteeringVolunteer:incident.typeLabel': 'What kind of concern?',
        'volunteeringVolunteer:incident.types.concern': "A concern about someone's welfare",
        'volunteeringVolunteer:incident.types.allegation': "An allegation about someone's behaviour",
        'volunteeringVolunteer:incident.types.disclosure': 'Someone told me something worrying',
        'volunteeringVolunteer:incident.types.near_miss': 'A near miss (nobody was harmed)',
        'volunteeringVolunteer:incident.types.other': 'Something else',
        'volunteeringVolunteer:incident.dateLabel': 'When did it happen?',
        'volunteeringVolunteer:incident.organisationLabel': 'Organisation (optional)',
        'volunteeringVolunteer:incident.organisationNone': 'Not linked to an organisation',
        'volunteeringVolunteer:incident.opportunityLabel': 'Opportunity (optional)',
        'volunteeringVolunteer:incident.opportunityNone': 'Not linked to an opportunity',
        'volunteeringVolunteer:incident.personLabel': 'Person involved (optional)',
        'volunteeringVolunteer:incident.personPlaceholder': 'Search members by name…',
        'volunteeringVolunteer:incident.personChosen': `About ${String(opts?.name ?? '')}`,
        'volunteeringVolunteer:incident.personClear': 'Remove person',
        'volunteeringVolunteer:incident.personPick': `Choose ${String(opts?.name ?? '')}`,
        'volunteeringVolunteer:incident.searchEmpty': 'No members found.',
        'volunteeringVolunteer:incident.searchError': 'Could not search members.',
        'volunteeringVolunteer:incident.descriptionLabel': 'What happened?',
        'volunteeringVolunteer:incident.descriptionPlaceholder': 'Describe what you saw or were told.',
        'volunteeringVolunteer:incident.descriptionMin': `Please write at least ${String(opts?.count ?? 0)} characters.`,
        'volunteeringVolunteer:incident.severityLabel': 'How serious is it?',
        'volunteeringVolunteer:incident.severities.low': 'Low',
        'volunteeringVolunteer:incident.severities.medium': 'Medium',
        'volunteeringVolunteer:incident.severities.high': 'High',
        'volunteeringVolunteer:incident.severities.critical': 'Critical',
        'volunteeringVolunteer:incident.categoryLabel': 'Category (optional)',
        'volunteeringVolunteer:incident.submit': 'Send report',
        'volunteeringVolunteer:incident.required': 'Please fill in all required fields.',
        'volunteeringVolunteer:incident.dateFuture': "The date can't be in the future.",
        'volunteeringVolunteer:incident.dateInvalid': 'Enter the date as YYYY-MM-DD.',
        'volunteeringVolunteer:incident.sentTitle': 'Report sent',
        'volunteeringVolunteer:incident.sentBody': `Your reference is #${String(opts?.id ?? '')}.`,
        'volunteeringVolunteer:incident.sentBodyNoId': 'Your community safeguarding lead will look at it.',
        'volunteeringVolunteer:incident.submitError': 'Could not send this report.',
        'volunteeringVolunteer:incident.optionsUnavailable': 'Organisations could not be loaded; you can still send the report.',
        'volunteeringVolunteer:incident.myReports': 'Your reports',
        'volunteeringVolunteer:incident.reportsEmpty': 'You have not sent any reports.',
        'volunteeringVolunteer:incident.reportsError': 'Could not load your reports.',
        'volunteeringVolunteer:incident.status.open': 'Received',
        'volunteeringVolunteer:incident.status.investigating': 'Being looked into',
        'volunteeringVolunteer:incident.status.escalated': 'Passed to a specialist',
        'volunteeringVolunteer:incident.status.resolved': 'Dealt with',
        'volunteeringVolunteer:incident.status.closed': 'Closed',
        'volunteeringVolunteer:incident.reference': `#${String(opts?.id ?? '')}`,
        'volunteeringVolunteer:unavailable.title': 'Not available in this community',
        'volunteeringVolunteer:unavailable.body': 'Switched off here.',
        'volunteeringVolunteer:unavailable.back': 'Back to volunteering',
        'volunteeringVolunteer:common.dateUnknown': 'Date unavailable',
        'common:unsavedChanges.title': 'Discard?',
        'common:unsavedChanges.message': 'Unsaved.',
        'common:unsavedChanges.discard': 'Discard',
        'common:buttons.cancel': 'Cancel',
        'common:buttons.retry': 'Retry',
        'common:errors.alertTitle': 'Error',
        'common:back': 'Back',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: () => true, tenant: { id: 2, slug: 'e2e', volunteering_config: mockVolunteeringConfig } }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#fff', surface: '#f8f9fa', text: '#000', textSecondary: '#666', textMuted: '#999',
    border: '#ddd', borderSubtle: '#eee', error: '#e53e3e', success: '#16a34a', warning: '#f59e0b',
  }),
}));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true, user: { id: 7 } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/Avatar', () => 'View');
const mockUnsavedGuard = jest.fn();
jest.mock('@/lib/hooks/useUnsavedChangesGuard', () => ({
  useUnsavedChangesGuard: (options: unknown) => mockUnsavedGuard(options),
}));
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({ confirm: jest.fn(), confirmDialog: null }),
}));
const mockShowToast = jest.fn();
jest.mock('@/components/ui/AppToast', () => ({
  useAppToast: () => ({ show: mockShowToast, hide: jest.fn(), isToastVisible: false }),
}));
jest.mock('@/lib/api/members', () => ({ getMembers: jest.fn() }));
jest.mock('@/lib/api/volunteeringVolunteer', () => ({
  ...jest.requireActual('@/lib/api/volunteeringVolunteer'),
  getIncidentReportOptions: jest.fn(),
  getMyIncidents: jest.fn(),
  reportIncident: jest.fn(),
}));

import IncidentReportScreen from './volunteer-incident-report';
import { getIncidentReportOptions, getMyIncidents, reportIncident } from '@/lib/api/volunteeringVolunteer';
import { getMembers } from '@/lib/api/members';
import { ApiResponseError } from '@/lib/api/client';

const LONG = 'Something happened at the shift that worried me a lot.';

beforeEach(() => {
  jest.clearAllMocks();
  mockVolunteeringConfig = {};
  jest.mocked(getIncidentReportOptions).mockResolvedValue({
    data: {
      organisations: [{ id: 4, name: 'Green Spaces' }, { id: 5, name: 'Meals Together' }],
      opportunities: [
        { id: 10, title: 'Garden tidy', organization_id: 4, organization_name: 'Green Spaces' },
        { id: 11, title: 'Food run', organization_id: 5, organization_name: 'Meals Together' },
      ],
    },
  });
  jest.mocked(getMyIncidents).mockResolvedValue({
    data: { items: [{ id: 3, title: 'Earlier report', incident_type: 'concern', description: 'x', status: 'investigating', severity: 'low', category: 'general', incident_date: '2026-09-01', created_at: '2026-09-01T10:00:00Z', organization_name: 'Green Spaces' }], total: 1 },
  });
  jest.mocked(reportIncident).mockResolvedValue({ data: { id: 42, status: 'open' } });
  jest.mocked(getMembers).mockResolvedValue({ data: [{ id: 9, name: 'Ada Member', first_name: 'Ada', tagline: null }, { id: 7, name: 'Me', first_name: 'Me', tagline: null }], meta: { total_items: 2, per_page: 20, offset: 0, has_more: false } } as never);
});

describe('IncidentReportScreen', () => {
  it('always shows the emergency warning and the member\'s earlier reports with their status', async () => {
    const { getByText } = render(<IncidentReportScreen />);
    expect(getByText(/call your local emergency number now/)).toBeTruthy();
    await waitFor(() => expect(getByText('Earlier report')).toBeTruthy());
    expect(getByText('Being looked into')).toBeTruthy();
  });

  it('refuses an empty form and a short description before sending', async () => {
    const { getByTestId } = render(<IncidentReportScreen />);
    await waitFor(() => expect(getByTestId('incident-submit')).toBeTruthy());
    fireEvent.press(getByTestId('incident-submit'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Please fill in all required fields.' })));
    fireEvent.changeText(getByTestId('incident-title'), 'Short');
    fireEvent.changeText(getByTestId('incident-description'), 'Too short');
    fireEvent.press(getByTestId('incident-submit'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Please write at least 20 characters.' })));
    expect(reportIncident).not.toHaveBeenCalled();
  });

  it('refuses a date in the future', async () => {
    const { getByTestId } = render(<IncidentReportScreen />);
    await waitFor(() => expect(getByTestId('incident-submit')).toBeTruthy());
    fireEvent.changeText(getByTestId('incident-title'), 'Title');
    fireEvent.changeText(getByTestId('incident-description'), LONG);
    fireEvent.changeText(getByTestId('incident-date'), '2999-01-01');
    fireEvent.press(getByTestId('incident-submit'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: "The date can't be in the future." })));
    expect(reportIncident).not.toHaveBeenCalled();
  });

  it('sends the website\'s payload — type, severity, the chosen organisation and opportunity, and the person found by name', async () => {
    const { getByTestId, getByText } = render(<IncidentReportScreen />);
    await waitFor(() => expect(getByTestId('incident-organisation-4')).toBeTruthy());
    fireEvent.changeText(getByTestId('incident-title'), 'Unsafe ladder');
    fireEvent.press(getByTestId('incident-type-near_miss'));
    fireEvent.press(getByTestId('incident-severity-high'));
    fireEvent.press(getByTestId('incident-organisation-4'));
    // Opportunities are filtered to the chosen organisation.
    await waitFor(() => expect(getByTestId('incident-opportunity-10')).toBeTruthy());
    fireEvent.press(getByTestId('incident-opportunity-10'));
    fireEvent.changeText(getByTestId('incident-date'), '2026-10-01');
    fireEvent.changeText(getByTestId('incident-description'), LONG);
    fireEvent.changeText(getByTestId('incident-category'), 'equipment');

    fireEvent.changeText(getByTestId('incident-person-search'), 'Ada');
    await waitFor(() => expect(getMembers).toHaveBeenCalledWith(0, 'Ada'));
    await waitFor(() => expect(getByTestId('incident-person-9')).toBeTruthy());
    fireEvent.press(getByTestId('incident-person-9'));
    await waitFor(() => expect(getByText('About Ada Member')).toBeTruthy());

    fireEvent.press(getByTestId('incident-submit'));
    await waitFor(() => expect(reportIncident).toHaveBeenCalledWith({
      title: 'Unsafe ladder',
      description: LONG,
      severity: 'high',
      incident_type: 'near_miss',
      category: 'equipment',
      incident_date: '2026-10-01',
      organization_id: 4,
      opportunity_id: 10,
      subject_user_id: 9,
    }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Report sent', description: 'Your reference is #42.' })));
    expect(getMyIncidents).toHaveBeenCalledTimes(2);
  });

  it('never offers the member themselves as the person involved', async () => {
    const { getByTestId, queryByTestId } = render(<IncidentReportScreen />);
    await waitFor(() => expect(getByTestId('incident-person-search')).toBeTruthy());
    fireEvent.changeText(getByTestId('incident-person-search'), 'Me');
    await waitFor(() => expect(getByTestId('incident-person-9')).toBeTruthy());
    expect(queryByTestId('incident-person-7')).toBeNull();
  });

  it('still lets the member send when the options cannot be loaded', async () => {
    jest.mocked(getIncidentReportOptions).mockRejectedValueOnce(new ApiResponseError(422, 'no options'));
    const { getByTestId, getByText } = render(<IncidentReportScreen />);
    await waitFor(() => expect(getByText('Organisations could not be loaded; you can still send the report.')).toBeTruthy());
    fireEvent.changeText(getByTestId('incident-title'), 'Title');
    fireEvent.changeText(getByTestId('incident-description'), LONG);
    fireEvent.press(getByTestId('incident-submit'));
    await waitFor(() => expect(reportIncident).toHaveBeenCalledWith(expect.objectContaining({ title: 'Title', severity: 'low', incident_type: 'concern' })));
  });

  it('shows the server\'s reason when the report is refused', async () => {
    jest.mocked(reportIncident).mockRejectedValueOnce(new ApiResponseError(429, 'Too many reports'));
    const { getByTestId } = render(<IncidentReportScreen />);
    await waitFor(() => expect(getByTestId('incident-submit')).toBeTruthy());
    fireEvent.changeText(getByTestId('incident-title'), 'Title');
    fireEvent.changeText(getByTestId('incident-description'), LONG);
    fireEvent.press(getByTestId('incident-submit'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Too many reports', variant: 'danger' })));
  });

  it('guards a half-written report against being lost', async () => {
    const { getByTestId } = render(<IncidentReportScreen />);
    await waitFor(() => expect(getByTestId('incident-submit')).toBeTruthy());
    fireEvent.changeText(getByTestId('incident-description'), 'started typing');
    await waitFor(() => expect(mockUnsavedGuard).toHaveBeenLastCalledWith(expect.objectContaining({ isDirty: true })));
  });

  it('refuses the screen when the community has safeguarding off', () => {
    mockVolunteeringConfig = { 'volunteering.tab_safeguarding': false };
    const { getByText } = render(<IncidentReportScreen />);
    expect(getByText('Not available in this community')).toBeTruthy();
    expect(getIncidentReportOptions).not.toHaveBeenCalled();
  });
});
