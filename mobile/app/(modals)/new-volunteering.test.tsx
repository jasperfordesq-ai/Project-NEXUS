// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockUseApi = jest.fn();
const mockCreateOpportunity = jest.fn();
const mockGetOpportunity = jest.fn();
const mockUpdateOpportunity = jest.fn();
const mockReplace = jest.fn();
const mockConfirm = jest.fn();
const mockNavListeners: Record<string, (e: unknown) => void> = {};
const mockNavDispatch = jest.fn();
let mockSearchParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  router: {
    back: jest.fn(),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
  useLocalSearchParams: () => mockSearchParams,
  useNavigation: () => ({
    addListener: (event: string, handler: (e: unknown) => void) => {
      mockNavListeners[event] = handler;
      return () => { delete mockNavListeners[event]; };
    },
    dispatch: (...args: unknown[]) => mockNavDispatch(...args),
  }),
}));
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({ confirm: (...args: unknown[]) => mockConfirm(...args), confirmDialog: null }),
}));
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/AccentIcon', () => {
  const React = require('react');
  const { View } = require('react-native');
  return () => <View testID="accent-icon" />;
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'create.eyebrow': 'New opportunity',
        'create.title': 'Create Opportunity',
        'create.editTitle': 'Edit Opportunity',
        'create.subtitle': 'Publish a volunteer role.',
        'create.editSubtitle': 'Update the volunteer role.',
        'create.organisationLabel': 'Organisation',
        'create.selectedOrganisation': `Posting for ${String(opts?.name ?? '')}`,
        'create.editOrganisationHint': 'Organisation changes are managed by organiser tools.',
        'create.noOrganisations': 'You need an approved organisation.',
        'create.titleLabel': 'Title',
        'create.titlePlaceholder': 'What help do you need?',
        'create.descriptionLabel': 'Description',
        'create.descriptionPlaceholder': 'Describe the role, support, and expected impact.',
        'create.locationLabel': 'Location',
        'create.locationPlaceholder': 'Where will this happen?',
        'create.skillsLabel': 'Skills needed',
        'create.skillsPlaceholder': 'Comma-separated skills',
        'create.startLabel': 'Start date',
        'create.endLabel': 'End date',
        'create.datePlaceholder': 'YYYY-MM-DD',
        'create.remote': 'Remote opportunity',
        'create.reviewTitle': 'Ready to publish?',
        'create.reviewSubtitle': 'Check before posting.',
        'create.editReviewTitle': 'Ready to update?',
        'create.editReviewSubtitle': 'Save your changes.',
        'create.submit': 'Create opportunity',
        'create.updateSubmit': 'Update opportunity',
        'create.validationTitle': 'Check opportunity details',
        'create.validationRequired': 'Choose an organisation and add a title and description.',
        'create.validationTitleMinLength': 'Use at least 5 characters for the title.',
        'create.validationDescriptionMinLength': 'Use at least 20 characters for the description.',
        'create.validationEndAfterStart': 'Use an end date after the start date.',
        'create.failedTitle': 'Opportunity not created',
        'create.failedDescription': 'We could not create the opportunity.',
        'create.editFailedTitle': 'Opportunity not updated',
        'create.editFailedDescription': 'We could not update the opportunity.',
        'create.loadFailed': 'Could not load opportunity.',
        'create.loadFailedTitle': "Couldn't open this opportunity",
        'create.organisationsLoadFailed': 'Your organisations could not be loaded.',
        'create.validationDateFormat': 'Enter dates as YYYY-MM-DD.',
        'create.reviewMissing': 'Add a title and description before continuing.',
        'create.unsavedTitle': 'Discard this opportunity?',
        'create.unsavedMessage': 'You have unsaved details.',
        'create.discard': 'Discard',
        'common:buttons.retry': 'Retry',
        'common:buttons.cancel': 'Cancel',
        'common:back': 'Back',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
  }),
}));

jest.mock('@/lib/api/volunteering', () => ({
  createOpportunity: (...args: unknown[]) => mockCreateOpportunity(...args),
  getOpportunity: (...args: unknown[]) => mockGetOpportunity(...args),
  getMyOrganisations: jest.fn(),
  updateOpportunity: (...args: unknown[]) => mockUpdateOpportunity(...args),
}));

jest.mock('@/lib/haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success' },
  ImpactFeedbackStyle: { Light: 'light' },
}));

// Stable AppToast mock — create the fns inside the factory closure so screens
// that list `show` in a useCallback/useEffect dependency array stay stable.
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

const { show: mockShowToast } = (jest.requireMock('@/components/ui/AppToast') as {
  useAppToast: () => { show: jest.Mock };
}).useAppToast();

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => <>{children}</>);
jest.mock('@/components/ui/FormActionFooter', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return function MockFormActionFooter({ subtitle, submitLabel, onSubmit, isDisabled }: { subtitle: string; submitLabel: string; onSubmit: () => void; isDisabled?: boolean }) {
    return (
      <View>
        <Text>{subtitle}</Text>
        <Pressable accessibilityRole="button" testID="footer-submit" accessibilityState={{ disabled: !!isDisabled }} disabled={isDisabled} onPress={onSubmit}>
          <Text>{submitLabel}</Text>
        </Pressable>
      </View>
    );
  };
});

jest.mock('heroui-native', () => {
  const React = require('react');
  const { Pressable, Text, TextInput, View } = require('react-native');
  const Button = ({ children, onPress, accessibilityLabel, accessibilityState }: { children: React.ReactNode; onPress?: () => void; accessibilityLabel?: string; accessibilityState?: Record<string, unknown> }) => (
    <Pressable onPress={onPress} accessibilityLabel={accessibilityLabel} accessibilityState={accessibilityState}>
      <View>{children}</View>
    </Pressable>
  );
  Button.Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  const Card = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Card.Body = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  const Surface = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  const Spinner = () => <View />;
  return {
    Button,
    Card,
    Spinner,
    Surface,
    Text,
    TextField: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    Label: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    Input: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => <TextInput ref={ref} {...props} />),
    FieldError: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
  };
});

import NewVolunteeringRoute from './new-volunteering';
import { firePreventedRemoval, isGuardArmed } from '@/lib/test/unsavedGuardHarness';

describe('NewVolunteeringRoute', () => {
  beforeEach(() => {
    mockSearchParams = {};
    mockUseApi.mockReset().mockReturnValue({
      data: { data: [{ id: 7, name: 'Helping Hands', status: 'approved', member_role: 'owner' }] },
      isLoading: false,
      error: null,
    });
    mockCreateOpportunity.mockReset().mockResolvedValue({ data: { id: 19 } });
    mockGetOpportunity.mockReset();
    mockUpdateOpportunity.mockReset().mockResolvedValue({ data: { id: 19 } });
    mockReplace.mockClear();
    mockShowToast.mockClear();
    mockConfirm.mockClear();
    mockNavDispatch.mockClear();
    Object.keys(mockNavListeners).forEach((key) => { delete mockNavListeners[key]; });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('requires the opportunity title to meet the React length limit', async () => {
    const { getByPlaceholderText, getByText } = render(<NewVolunteeringRoute />);

    fireEvent.press(getByText('Helping Hands'));
    fireEvent.changeText(getByPlaceholderText('What help do you need?'), 'Help');
    fireEvent.changeText(getByPlaceholderText('Describe the role, support, and expected impact.'), 'Help pack and deliver food parcels for local families.');
    fireEvent.press(getByText('Create opportunity'));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Check opportunity details', description: 'Use at least 5 characters for the title.', variant: 'warning' }));
    });
    expect(mockCreateOpportunity).not.toHaveBeenCalled();
  });

  it('auto-selects the only approved organisation the member can manage', async () => {
    const { getByPlaceholderText, getByText } = render(<NewVolunteeringRoute />);

    fireEvent.changeText(getByPlaceholderText('What help do you need?'), 'Food bank help');
    fireEvent.changeText(getByPlaceholderText('Describe the role, support, and expected impact.'), 'Help pack and deliver food parcels for local families.');
    fireEvent.press(getByText('Create opportunity'));

    await waitFor(() => {
      expect(mockCreateOpportunity).toHaveBeenCalledWith(expect.objectContaining({
        organization_id: 7,
        title: 'Food bank help',
      }));
    });
  });

  it('only offers approved owner or admin organisations for new opportunities', () => {
    mockUseApi.mockReturnValue({
      data: {
        data: [
          { id: 7, name: 'Helping Hands', status: 'approved', member_role: 'owner' },
          { id: 8, name: 'Pending Helpers', status: 'pending', member_role: 'owner' },
          { id: 9, name: 'Volunteer Friends', status: 'approved', member_role: 'member' },
          { id: 10, name: 'Active Admins', status: 'active', member_role: 'admin' },
        ],
      },
      isLoading: false,
      error: null,
    });

    const { getByText, queryByText } = render(<NewVolunteeringRoute />);

    expect(getByText('Helping Hands')).toBeTruthy();
    expect(getByText('Active Admins')).toBeTruthy();
    expect(queryByText('Pending Helpers')).toBeNull();
    expect(queryByText('Volunteer Friends')).toBeNull();
  });

  it('requires the opportunity description to meet the React length limit', async () => {
    const { getByPlaceholderText, getByText } = render(<NewVolunteeringRoute />);

    fireEvent.press(getByText('Helping Hands'));
    fireEvent.changeText(getByPlaceholderText('What help do you need?'), 'Food bank help');
    fireEvent.changeText(getByPlaceholderText('Describe the role, support, and expected impact.'), 'Too short.');
    fireEvent.press(getByText('Create opportunity'));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Check opportunity details', description: 'Use at least 20 characters for the description.', variant: 'warning' }));
    });
    expect(mockCreateOpportunity).not.toHaveBeenCalled();
  });

  it('requires the end date to be after the start date', async () => {
    const { getAllByPlaceholderText, getByPlaceholderText, getByText } = render(<NewVolunteeringRoute />);

    fireEvent.press(getByText('Helping Hands'));
    fireEvent.changeText(getByPlaceholderText('What help do you need?'), 'Food bank help');
    fireEvent.changeText(getByPlaceholderText('Describe the role, support, and expected impact.'), 'Help pack and deliver food parcels for local families.');
    const [startDateInput, endDateInput] = getAllByPlaceholderText('YYYY-MM-DD');
    fireEvent.changeText(startDateInput, '2026-06-10');
    fireEvent.changeText(endDateInput, '2026-06-09');
    fireEvent.press(getByText('Create opportunity'));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Check opportunity details', description: 'Use an end date after the start date.', variant: 'warning' }));
    });
    expect(mockCreateOpportunity).not.toHaveBeenCalled();
  });

  it('hydrates and updates an existing volunteering opportunity in edit mode', async () => {
    mockSearchParams = { id: '19' };
    mockGetOpportunity.mockResolvedValueOnce({
      data: {
        id: 19,
        title: 'Food bank packing',
        description: 'Help pack food parcels for local families every week.',
        organisation: { id: 7, name: 'Helping Hands' },
        location: 'Community hall',
        is_remote: false,
        skills_needed: ['Packing', 'Lifting'],
        status: 'open',
        spots_available: null,
        deadline: null,
        created_at: '2026-05-01T00:00:00Z',
        start_date: '2026-06-01T00:00:00Z',
        end_date: '2026-06-30T00:00:00Z',
      },
    });

    const { getByDisplayValue, getByText } = render(<NewVolunteeringRoute />);

    await waitFor(() => expect(getByDisplayValue('Food bank packing')).toBeTruthy());
    expect(getByText('Edit Opportunity')).toBeTruthy();
    expect(getByText('Update the volunteer role.')).toBeTruthy();
    fireEvent.changeText(getByDisplayValue('Food bank packing'), 'Updated packing shift');
    fireEvent.press(getByText('Update opportunity'));

    await waitFor(() => {
      expect(mockUpdateOpportunity).toHaveBeenCalledWith(19, expect.objectContaining({
        title: 'Updated packing shift',
        description: 'Help pack food parcels for local families every week.',
        skills_needed: 'Packing, Lifting',
        start_date: '2026-06-01',
        end_date: '2026-06-30',
      }));
    });
  });

  it('allows editing an existing opportunity when the organisation list is empty', async () => {
    mockSearchParams = { id: '19' };
    mockUseApi.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      error: null,
    });
    mockGetOpportunity.mockResolvedValueOnce({
      data: {
        id: 19,
        title: 'Food bank packing',
        description: 'Help pack food parcels for local families every week.',
        organisation: { id: 7, name: 'Helping Hands' },
        location: 'Community hall',
        is_remote: false,
        skills_needed: ['Packing'],
        status: 'open',
        spots_available: null,
        deadline: null,
        created_at: '2026-05-01T00:00:00Z',
        start_date: null,
        end_date: null,
      },
    });

    const { getByDisplayValue, getByText } = render(<NewVolunteeringRoute />);

    await waitFor(() => expect(getByDisplayValue('Food bank packing')).toBeTruthy());
    fireEvent.changeText(getByDisplayValue('Food bank packing'), 'Updated packing shift');
    fireEvent.press(getByText('Update opportunity'));

    await waitFor(() => {
      expect(mockUpdateOpportunity).toHaveBeenCalledWith(19, expect.objectContaining({
        title: 'Updated packing shift',
        location: 'Community hall',
      }));
    });
  });

  /** 🔴 S4-03. A failed hydration must not leave a live "Update opportunity" over blank fields. */
  it('withholds the form when the opportunity cannot be loaded, offers a retry, and never saves blanks', async () => {
    mockSearchParams = { id: '19' };
    mockGetOpportunity.mockRejectedValueOnce(new Error('offline'));

    const { getByText, queryByText, getByDisplayValue } = render(<NewVolunteeringRoute />);

    await waitFor(() => expect(getByText("Couldn't open this opportunity")).toBeTruthy());
    expect(queryByText('Update opportunity')).toBeNull();
    expect(mockUpdateOpportunity).not.toHaveBeenCalled();

    mockGetOpportunity.mockResolvedValueOnce({ data: { id: 19, title: 'Food bank packing', description: 'Help pack food parcels for local families every week.', organisation: { id: 7, name: 'Helping Hands' }, location: null, is_remote: false, skills_needed: [], status: 'open', spots_available: null, deadline: null, created_at: '2026-05-01T00:00:00Z', start_date: null, end_date: null } });
    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(getByDisplayValue('Food bank packing')).toBeTruthy());
    expect(getByText('Update opportunity')).toBeTruthy();
  });

  /** 🔴 S4-08. A failed organisation load used to read as "no organisations" and disable the form for ever. */
  it('says the organisations failed to load, offers a retry, and keeps publishing blocked until it works', () => {
    const refresh = jest.fn();
    mockUseApi.mockReturnValue({ data: null, isLoading: false, error: 'Network error', refresh });

    const { getByTestId, getByText, queryByText } = render(<NewVolunteeringRoute />);

    expect(getByTestId('new-volunteering-organisations-failed')).toBeTruthy();
    expect(queryByText('You need an approved organisation.')).toBeNull();
    fireEvent.press(getByText('Retry'));
    expect(refresh).toHaveBeenCalled();
    expect(getByTestId('footer-submit').props.accessibilityState.disabled).toBe(true);
  });

  /** S4-04. Dirty input is guarded on Back / gestures. */
  it('asks before discarding unsaved input', () => {
    const { getByPlaceholderText } = render(<NewVolunteeringRoute />);
    expect(isGuardArmed()).toBe(false);
    fireEvent.changeText(getByPlaceholderText('What help do you need?'), 'Half-typed');
    expect(isGuardArmed()).toBe(true);

    firePreventedRemoval();
    expect(mockNavDispatch).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard this opportunity?' }));
  });

  /** S4-25. A mistyped date is a format problem, not a missing field. */
  it('reports a mistyped date as an invalid format', async () => {
    const { getByPlaceholderText, getAllByPlaceholderText, getByText } = render(<NewVolunteeringRoute />);
    fireEvent.changeText(getByPlaceholderText('What help do you need?'), 'Food bank packing');
    fireEvent.changeText(getByPlaceholderText('Describe the role, support, and expected impact.'), 'Help pack food parcels for local families every week.');
    fireEvent.changeText(getAllByPlaceholderText('YYYY-MM-DD')[0], '31/12/2026');
    fireEvent.press(getByText('Create opportunity'));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Enter dates as YYYY-MM-DD.' })));
    expect(mockCreateOpportunity).not.toHaveBeenCalled();
  });

  /** S4-22. The remote toggle paints its icon with the accent foreground once selected, and announces its state. */
  it('uses the accent foreground for the selected remote toggle icon', () => {
    const { getByLabelText, queryAllByTestId } = render(<NewVolunteeringRoute />);
    expect(getByLabelText('Remote opportunity').props.accessibilityState).toEqual(expect.objectContaining({ selected: false }));
    expect(queryAllByTestId('accent-icon')).toHaveLength(0);
    fireEvent.press(getByLabelText('Remote opportunity'));
    expect(getByLabelText('Remote opportunity').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(queryAllByTestId('accent-icon')).toHaveLength(1);
  });

  /** S6-07. Footer copy and disabled state follow the required fields. */
  it('derives the footer copy and disabled state from the required fields', () => {
    const { getByPlaceholderText, getByTestId, getByText } = render(<NewVolunteeringRoute />);
    expect(getByText('Add a title and description before continuing.')).toBeTruthy();
    expect(getByTestId('footer-submit').props.accessibilityState.disabled).toBe(true);

    fireEvent.changeText(getByPlaceholderText('What help do you need?'), 'Food bank packing');
    fireEvent.changeText(getByPlaceholderText('Describe the role, support, and expected impact.'), 'Help pack food parcels for local families every week.');
    expect(getByText('Check before posting.')).toBeTruthy();
    expect(getByTestId('footer-submit').props.accessibilityState.disabled).toBe(false);
  });
});
