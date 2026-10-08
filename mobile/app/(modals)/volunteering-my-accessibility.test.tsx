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
        'volunteeringVolunteer:accessibility.title': 'Accessibility needs',
        'volunteeringVolunteer:accessibility.intro': 'Tell us what would help you volunteer.',
        'volunteeringVolunteer:accessibility.privacy': 'This is a private note for you. Organisations and coordinators cannot see it.',
        'volunteeringVolunteer:accessibility.empty': 'No needs recorded.',
        'volunteeringVolunteer:accessibility.add': 'Add a need',
        'volunteeringVolunteer:accessibility.typeLabel': 'Type of need',
        'volunteeringVolunteer:accessibility.types.mobility': 'Mobility',
        'volunteeringVolunteer:accessibility.types.visual': 'Visual',
        'volunteeringVolunteer:accessibility.types.hearing': 'Hearing',
        'volunteeringVolunteer:accessibility.types.cognitive': 'Cognitive',
        'volunteeringVolunteer:accessibility.types.dietary': 'Dietary',
        'volunteeringVolunteer:accessibility.types.language': 'Language',
        'volunteeringVolunteer:accessibility.types.other': 'Other',
        'volunteeringVolunteer:accessibility.descriptionLabel': 'Describe the need',
        'volunteeringVolunteer:accessibility.accommodationsLabel': 'What would help',
        'volunteeringVolunteer:accessibility.contactNameLabel': 'Emergency contact name',
        'volunteeringVolunteer:accessibility.contactPhoneLabel': 'Emergency contact phone',
        'volunteeringVolunteer:accessibility.remove': 'Remove this need',
        'volunteeringVolunteer:accessibility.removeLabel': `Remove the ${String(opts?.type ?? '')} need`,
        'volunteeringVolunteer:accessibility.save': 'Save needs',
        'volunteeringVolunteer:accessibility.savedTitle': 'Saved',
        'volunteeringVolunteer:accessibility.savedBody': 'Your accessibility needs have been updated.',
        'volunteeringVolunteer:accessibility.saveError': 'Could not save your needs.',
        'volunteeringVolunteer:accessibility.duplicateType': 'Each type of need can only be added once.',
        'volunteeringVolunteer:accessibility.loadError': 'Could not load your accessibility needs.',
        'volunteeringVolunteer:accessibility.needHeading': `Need ${String(opts?.index ?? '')}`,
        'volunteeringVolunteer:unavailable.title': 'Not available in this community',
        'volunteeringVolunteer:unavailable.body': 'Switched off here.',
        'volunteeringVolunteer:unavailable.back': 'Back to volunteering',
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
jest.mock('@/lib/api/volunteeringVolunteer', () => ({
  ...jest.requireActual('@/lib/api/volunteeringVolunteer'),
  getAccessibilityNeeds: jest.fn(),
  updateAccessibilityNeeds: jest.fn(),
}));

import MyAccessibilityScreen from './volunteering-my-accessibility';
import { getAccessibilityNeeds, updateAccessibilityNeeds } from '@/lib/api/volunteeringVolunteer';
import { ApiResponseError } from '@/lib/api/client';

const mobility = {
  id: 1, need_type: 'mobility', description: 'I use a stick', accommodations_required: 'Somewhere to sit',
  emergency_contact_name: 'Pat', emergency_contact_phone: '+353 1 555 0100',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockVolunteeringConfig = {};
  jest.mocked(getAccessibilityNeeds).mockResolvedValue({ data: [mobility] });
  jest.mocked(updateAccessibilityNeeds).mockResolvedValue({ data: { success: true } });
});

describe('MyAccessibilityScreen', () => {
  it('shows the privacy notice and the existing need', async () => {
    const { getByText, getByTestId } = render(<MyAccessibilityScreen />);
    expect(getByText(/private note for you/)).toBeTruthy();
    await waitFor(() => expect(getByTestId('accessibility-need-0')).toBeTruthy());
    expect(getByTestId('accessibility-description-0').props.value).toBe('I use a stick');
  });

  it('adds a second need, edits it and saves the WHOLE set', async () => {
    const { getByTestId } = render(<MyAccessibilityScreen />);
    await waitFor(() => expect(getByTestId('accessibility-add')).toBeTruthy());
    fireEvent.press(getByTestId('accessibility-add'));
    await waitFor(() => expect(getByTestId('accessibility-need-1')).toBeTruthy());
    fireEvent.press(getByTestId('accessibility-type-1-dietary'));
    fireEvent.changeText(getByTestId('accessibility-description-1'), 'Vegetarian');
    fireEvent.press(getByTestId('accessibility-save'));
    await waitFor(() => expect(updateAccessibilityNeeds).toHaveBeenCalledWith([
      expect.objectContaining({ need_type: 'mobility', description: 'I use a stick' }),
      expect.objectContaining({ need_type: 'dietary', description: 'Vegetarian' }),
    ]));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Saved' })));
    expect(getAccessibilityNeeds).toHaveBeenCalledTimes(2);
  });

  it('refuses two needs of the same type before sending', async () => {
    const { getByTestId } = render(<MyAccessibilityScreen />);
    await waitFor(() => expect(getByTestId('accessibility-add')).toBeTruthy());
    fireEvent.press(getByTestId('accessibility-add'));
    await waitFor(() => expect(getByTestId('accessibility-need-1')).toBeTruthy());
    fireEvent.press(getByTestId('accessibility-type-1-mobility'));
    fireEvent.press(getByTestId('accessibility-save'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Each type of need can only be added once.' })));
    expect(updateAccessibilityNeeds).not.toHaveBeenCalled();
  });

  it('removing the only need and saving sends an empty set, which is how the server deletes', async () => {
    const { getByTestId } = render(<MyAccessibilityScreen />);
    await waitFor(() => expect(getByTestId('accessibility-remove-0')).toBeTruthy());
    fireEvent.press(getByTestId('accessibility-remove-0'));
    fireEvent.press(getByTestId('accessibility-save'));
    await waitFor(() => expect(updateAccessibilityNeeds).toHaveBeenCalledWith([]));
  });

  it('marks the form dirty once something changes', async () => {
    const { getByTestId } = render(<MyAccessibilityScreen />);
    await waitFor(() => expect(getByTestId('accessibility-description-0')).toBeTruthy());
    fireEvent.changeText(getByTestId('accessibility-description-0'), 'changed');
    await waitFor(() => expect(mockUnsavedGuard).toHaveBeenLastCalledWith(expect.objectContaining({ isDirty: true })));
  });

  it('shows the server\'s reason when the save is refused', async () => {
    jest.mocked(updateAccessibilityNeeds).mockRejectedValueOnce(new ApiResponseError(422, 'Phone is too long'));
    const { getByTestId } = render(<MyAccessibilityScreen />);
    await waitFor(() => expect(getByTestId('accessibility-save')).toBeTruthy());
    fireEvent.press(getByTestId('accessibility-save'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Phone is too long', variant: 'danger' })));
  });

  it('shows the empty state and a retry on failure', async () => {
    jest.mocked(getAccessibilityNeeds).mockResolvedValueOnce({ data: [] });
    const { getByText, unmount } = render(<MyAccessibilityScreen />);
    await waitFor(() => expect(getByText('No needs recorded.')).toBeTruthy());
    unmount();
    jest.mocked(getAccessibilityNeeds).mockRejectedValueOnce(new ApiResponseError(422, 'down'));
    const { getByTestId } = render(<MyAccessibilityScreen />);
    await waitFor(() => expect(getByTestId('accessibility-error')).toBeTruthy());
  });

  it('refuses the screen when the community has it off', () => {
    mockVolunteeringConfig = { 'volunteering.tab_accessibility': false };
    const { getByText } = render(<MyAccessibilityScreen />);
    expect(getByText('Not available in this community')).toBeTruthy();
    expect(getAccessibilityNeeds).not.toHaveBeenCalled();
  });
});
