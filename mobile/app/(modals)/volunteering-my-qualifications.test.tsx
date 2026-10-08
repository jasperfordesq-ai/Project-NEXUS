// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));

let mockVolunteeringConfig: Record<string, unknown> = {};

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => callback(), [callback]);
  },
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
}));
jest.mock('@/components/ui/BottomSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
    visible ? <View testID="qualification-sheet">{children}</View> : null;
});
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'volunteeringVolunteer:qualifications.title': 'Qualifications',
        'volunteeringVolunteer:qualifications.intro': 'A record of what you hold. Nothing is uploaded.',
        'volunteeringVolunteer:qualifications.add': 'Add qualification',
        'volunteeringVolunteer:qualifications.edit': 'Edit',
        'volunteeringVolunteer:qualifications.withdraw': 'Withdraw',
        'volunteeringVolunteer:qualifications.editLabel': `Edit ${String(opts?.title ?? '')}`,
        'volunteeringVolunteer:qualifications.withdrawLabel': `Withdraw ${String(opts?.title ?? '')}`,
        'volunteeringVolunteer:qualifications.empty': 'No qualifications recorded yet.',
        'volunteeringVolunteer:qualifications.counts.confirmed': 'Confirmed',
        'volunteeringVolunteer:qualifications.counts.recorded': 'Awaiting confirmation',
        'volunteeringVolunteer:qualifications.counts.expiring': 'Expiring soon',
        'volunteeringVolunteer:qualifications.counts.expired': 'Expired',
        'volunteeringVolunteer:qualifications.status.recorded': 'Awaiting confirmation',
        'volunteeringVolunteer:qualifications.status.confirmed': 'Confirmed',
        'volunteeringVolunteer:qualifications.status.expired': 'Expired',
        'volunteeringVolunteer:qualifications.status.withdrawn': 'Withdrawn',
        'volunteeringVolunteer:qualifications.status.expiring': 'Expiring soon',
        'volunteeringVolunteer:qualifications.types.first_aid': 'First aid',
        'volunteeringVolunteer:qualifications.types.other': 'Other',
        'volunteeringVolunteer:qualifications.types.food_hygiene': 'Food hygiene',
        'volunteeringVolunteer:qualifications.typeLabel': 'Type',
        'volunteeringVolunteer:qualifications.nameLabel': 'Name',
        'volunteeringVolunteer:qualifications.nameOptionalLabel': 'Name or course (optional)',
        'volunteeringVolunteer:qualifications.issuerLabel': 'Issuer',
        'volunteeringVolunteer:qualifications.referenceLabel': 'Reference number',
        'volunteeringVolunteer:qualifications.obtainedLabel': 'Date obtained',
        'volunteeringVolunteer:qualifications.expiresLabel': 'Expiry date',
        'volunteeringVolunteer:qualifications.expiresHint': 'Leave empty if it does not expire.',
        'volunteeringVolunteer:qualifications.expiryHint': `Usually valid for ${String(opts?.count ?? 0)} years`,
        'volunteeringVolunteer:qualifications.notesLabel': 'Notes',
        'volunteeringVolunteer:qualifications.save': 'Save',
        'volunteeringVolunteer:qualifications.saveError': 'Could not save this qualification.',
        'volunteeringVolunteer:qualifications.savedTitle': 'Qualification saved',
        'volunteeringVolunteer:qualifications.savedBody': 'Your community can confirm it when they see the original.',
        'volunteeringVolunteer:qualifications.titleRequired': 'Give the qualification a name.',
        'volunteeringVolunteer:qualifications.expiryBeforeObtained': 'The expiry date is before the date obtained.',
        'volunteeringVolunteer:qualifications.dateInvalid': 'Enter dates as YYYY-MM-DD.',
        'volunteeringVolunteer:qualifications.editConfirmedWarning': 'Editing a confirmed qualification removes its confirmation.',
        'volunteeringVolunteer:qualifications.withdrawTitle': 'Withdraw this qualification?',
        'volunteeringVolunteer:qualifications.withdrawReason': 'Why?',
        'volunteeringVolunteer:qualifications.reasons.volunteer_request': 'I no longer want this shown',
        'volunteeringVolunteer:qualifications.reasons.no_longer_held': 'I no longer hold it',
        'volunteeringVolunteer:qualifications.reasons.entered_in_error': 'Entered by mistake',
        'volunteeringVolunteer:qualifications.reasons.replaced': 'Replaced by a newer one',
        'volunteeringVolunteer:qualifications.withdrawConfirm': 'Withdraw',
        'volunteeringVolunteer:qualifications.withdrawError': 'Could not withdraw this qualification.',
        'volunteeringVolunteer:qualifications.withdrawnTitle': 'Qualification withdrawn',
        'volunteeringVolunteer:qualifications.confirmedBy': `Confirmed by ${String(opts?.name ?? '')}`,
        'volunteeringVolunteer:qualifications.obtained': `Obtained ${String(opts?.date ?? '')}`,
        'volunteeringVolunteer:qualifications.expiresOn': `Expires ${String(opts?.date ?? '')}`,
        'volunteeringVolunteer:qualifications.expiredOn': `Expired ${String(opts?.date ?? '')}`,
        'volunteeringVolunteer:qualifications.noExpiry': 'No expiry',
        'volunteeringVolunteer:qualifications.withdrawnOn': `Withdrawn ${String(opts?.date ?? '')}`,
        'volunteeringVolunteer:qualifications.reference': `Ref ${String(opts?.reference ?? '')}`,
        'volunteeringVolunteer:qualifications.loadError': 'Could not load your qualifications.',
        'volunteeringVolunteer:qualifications.formTitleAdd': 'Add a qualification',
        'volunteeringVolunteer:qualifications.formTitleEdit': 'Edit qualification',
        'volunteeringVolunteer:unavailable.title': 'Not available in this community',
        'volunteeringVolunteer:unavailable.body': 'Switched off here.',
        'volunteeringVolunteer:unavailable.back': 'Back to volunteering',
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
const mockShowToast = jest.fn();
jest.mock('@/components/ui/AppToast', () => ({
  useAppToast: () => ({ show: mockShowToast, hide: jest.fn(), isToastVisible: false }),
}));
jest.mock('@/lib/api/volunteeringVolunteer', () => ({
  ...jest.requireActual('@/lib/api/volunteeringVolunteer'),
  getQualifications: jest.fn(),
  createQualification: jest.fn(),
  updateQualification: jest.fn(),
  withdrawQualification: jest.fn(),
}));

import MyQualificationsScreen from './volunteering-my-qualifications';
import { createQualification, getQualifications, updateQualification, withdrawQualification } from '@/lib/api/volunteeringVolunteer';
import { ApiResponseError } from '@/lib/api/client';

const firstAid = {
  id: 1, user_id: 7, qualification_type: 'first_aid', title: 'Occupational First Aid', issuer: 'Red Cross',
  reference_number: 'OFA-1', obtained_at: '2025-03-01', expires_at: '2027-03-01', status: 'confirmed', is_expiring: false,
  days_until_expiry: 500, confirmed_by: { id: 3, name: 'Pat Staff' }, confirmed_at: '2025-04-01T10:00:00Z',
  confirmation_method: 'saw_original', confirmed_for_organization: { id: 4, name: 'Green Spaces' }, withdrawn_at: null,
  withdrawal_reason: null, notes: null,
};
const listing = {
  data: {
    items: [firstAid],
    counts: { confirmed: 1, recorded: 0, expiring: 0, expired: 0 },
    reminder_window_days: 30,
    types: [
      { code: 'first_aid', label_key: 'qualifications.types.first_aid', expiry_hint_years: 2 },
      { code: 'food_hygiene', label_key: 'qualifications.types.food_hygiene', expiry_hint_years: null },
      { code: 'other', label_key: 'qualifications.types.other', expiry_hint_years: null },
    ],
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockVolunteeringConfig = {};
  jest.mocked(getQualifications).mockResolvedValue(listing);
  jest.mocked(createQualification).mockResolvedValue({ data: firstAid });
  jest.mocked(updateQualification).mockResolvedValue({ data: firstAid });
  jest.mocked(withdrawQualification).mockResolvedValue({ data: { ...firstAid, status: 'withdrawn' } });
});

describe('MyQualificationsScreen', () => {
  it('lists the record with its status and who confirmed it', async () => {
    const { getByText, getAllByText } = render(<MyQualificationsScreen />);
    await waitFor(() => expect(getByText('Occupational First Aid')).toBeTruthy());
    expect(getAllByText('Confirmed').length).toBeGreaterThan(0);
    expect(getByText('Confirmed by Pat Staff')).toBeTruthy();
    expect(getByText(/Ref OFA-1/)).toBeTruthy();
  });

  it('adds a record with the website\'s fields, and never offers a file', async () => {
    // 🔴 Owner decision 2026-10-07: no qualification uploads anywhere. The screen must not
    // even import a picker; read from source because a missing button cannot be queried.
    const source = fs.readFileSync(path.join(__dirname, 'volunteering-my-qualifications.tsx'), 'utf8');
    expect(source).not.toMatch(/expo-image-picker|expo-document-picker|launchImageLibraryAsync|FormData|api\.upload/);

    const { getByTestId } = render(<MyQualificationsScreen />);
    await waitFor(() => expect(getByTestId('qualifications-add')).toBeTruthy());
    fireEvent.press(getByTestId('qualifications-add'));
    await waitFor(() => expect(getByTestId('qualification-sheet')).toBeTruthy());

    fireEvent.press(getByTestId('qualification-type-food_hygiene'));
    fireEvent.changeText(getByTestId('qualification-title'), ' Level 2 ');
    fireEvent.changeText(getByTestId('qualification-issuer'), 'FSAI');
    fireEvent.changeText(getByTestId('qualification-obtained'), '2026-01-10');
    fireEvent.press(getByTestId('qualification-save'));

    await waitFor(() => expect(createQualification).toHaveBeenCalledWith({
      qualification_type: 'food_hygiene',
      title: ' Level 2 ',
      issuer: 'FSAI',
      reference_number: '',
      obtained_at: '2026-01-10',
      expires_at: '',
      notes: '',
    }));
    await waitFor(() => expect(getQualifications).toHaveBeenCalledTimes(2));
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Qualification saved' }));
  });

  it('refuses "other" without a name, and an expiry before the obtained date, before sending', async () => {
    const { getByTestId } = render(<MyQualificationsScreen />);
    await waitFor(() => expect(getByTestId('qualifications-add')).toBeTruthy());
    fireEvent.press(getByTestId('qualifications-add'));
    await waitFor(() => expect(getByTestId('qualification-sheet')).toBeTruthy());

    fireEvent.press(getByTestId('qualification-type-other'));
    fireEvent.press(getByTestId('qualification-save'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Give the qualification a name.' })));

    fireEvent.changeText(getByTestId('qualification-title'), 'Thing');
    fireEvent.changeText(getByTestId('qualification-obtained'), '2026-05-01');
    fireEvent.changeText(getByTestId('qualification-expires'), '2026-01-01');
    fireEvent.press(getByTestId('qualification-save'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'The expiry date is before the date obtained.' })));
    expect(createQualification).not.toHaveBeenCalled();
  });

  it('edits an existing record through PUT and warns that confirmation is lost', async () => {
    const { getByTestId, getByText } = render(<MyQualificationsScreen />);
    await waitFor(() => expect(getByTestId('qualification-edit-1')).toBeTruthy());
    fireEvent.press(getByTestId('qualification-edit-1'));
    await waitFor(() => expect(getByText('Editing a confirmed qualification removes its confirmation.')).toBeTruthy());
    fireEvent.changeText(getByTestId('qualification-issuer'), 'Irish Red Cross');
    fireEvent.press(getByTestId('qualification-save'));
    await waitFor(() => expect(updateQualification).toHaveBeenCalledWith(1, expect.objectContaining({ qualification_type: 'first_aid', issuer: 'Irish Red Cross' })));
    expect(createQualification).not.toHaveBeenCalled();
  });

  it('withdraws with a chosen reason', async () => {
    const { getByTestId } = render(<MyQualificationsScreen />);
    await waitFor(() => expect(getByTestId('qualification-withdraw-1')).toBeTruthy());
    fireEvent.press(getByTestId('qualification-withdraw-1'));
    await waitFor(() => expect(getByTestId('qualification-withdraw-confirm')).toBeTruthy());
    fireEvent.press(getByTestId('qualification-reason-no_longer_held'));
    await act(async () => { fireEvent.press(getByTestId('qualification-withdraw-confirm')); });
    await waitFor(() => expect(withdrawQualification).toHaveBeenCalledWith(1, 'no_longer_held'));
    expect(getQualifications).toHaveBeenCalledTimes(2);
  });

  it('shows the server\'s reason when a save is refused', async () => {
    jest.mocked(createQualification).mockRejectedValueOnce(new ApiResponseError(422, 'Police checks are not recorded here.'));
    const { getByTestId } = render(<MyQualificationsScreen />);
    await waitFor(() => expect(getByTestId('qualifications-add')).toBeTruthy());
    fireEvent.press(getByTestId('qualifications-add'));
    await waitFor(() => expect(getByTestId('qualification-sheet')).toBeTruthy());
    fireEvent.press(getByTestId('qualification-type-first_aid'));
    fireEvent.press(getByTestId('qualification-save'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Police checks are not recorded here.', variant: 'danger' })));
  });

  it('shows the empty state and a retry on failure', async () => {
    jest.mocked(getQualifications).mockResolvedValueOnce({ data: { ...listing.data, items: [] } });
    const { getByText, unmount } = render(<MyQualificationsScreen />);
    await waitFor(() => expect(getByText('No qualifications recorded yet.')).toBeTruthy());
    unmount();
    jest.mocked(getQualifications).mockRejectedValueOnce(new ApiResponseError(422, 'down'));
    const { getByTestId } = render(<MyQualificationsScreen />);
    await waitFor(() => expect(getByTestId('qualifications-error')).toBeTruthy());
  });

  it('refuses the screen when the community has the register off', () => {
    mockVolunteeringConfig = { 'volunteering.tab_credentials': false };
    const { getByText } = render(<MyQualificationsScreen />);
    expect(getByText('Not available in this community')).toBeTruthy();
    expect(getQualifications).not.toHaveBeenCalled();
  });
});
