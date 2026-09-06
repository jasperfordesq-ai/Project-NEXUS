// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCreateOrganisation = jest.fn();
const mockConfirm = jest.fn();
const mockNavListeners: Record<string, (e: unknown) => void> = {};
const mockNavDispatch = jest.fn();

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  router: {
    back: (...args: unknown[]) => mockBack(...args),
    push: jest.fn(),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
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

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'register.title': 'Register organisation',
        'register.eyebrow': 'Volunteer partner',
        'register.subtitle': 'Create an organisation profile for admin review before posting opportunities.',
        'register.nameLabel': 'Organisation name',
        'register.namePlaceholder': 'Community skills network',
        'register.descriptionLabel': 'Description',
        'register.descriptionPlaceholder': 'Tell members what your organisation does and how volunteers can help.',
        'register.emailLabel': 'Contact email',
        'register.emailPlaceholder': 'contact@example.org',
        'register.websiteLabel': 'Website',
        'register.websitePlaceholder': 'https://example.org',
        'register.termsTitle': 'Review before approval',
        'register.termsSummary': 'Organisation profiles are reviewed by community admins before they appear as approved partners.',
        'register.termsAgreement': 'I confirm I am authorised to register this organisation and the details are accurate.',
        'register.pendingApprovalNotice': 'New organisations start as pending until a community admin approves the profile.',
        'register.submit': 'Submit for review',
        'register.cancel': 'Cancel',
        'register.successTitle': 'Organisation submitted',
        'register.successMessage': 'Your organisation has been sent for review.',
        'register.saveFailedTitle': 'Could not register organisation',
        'register.saveFailedMessage': 'We could not submit this organisation right now.',
        'register.errors.nameRequired': 'Enter the organisation name.',
        'register.errors.nameMin': 'Organisation name must be at least 3 characters.',
        'register.errors.descriptionRequired': 'Enter a description.',
        'register.errors.descriptionMin': 'Description must be at least 20 characters.',
        'register.errors.emailRequired': 'Enter a contact email.',
        'register.errors.emailInvalid': 'Enter a valid email address.',
        'register.errors.websiteInvalid': 'Enter a full website URL starting with http:// or https://.',
        'register.errors.termsRequired': 'Confirm you are authorised to register this organisation.',
        'register.unsavedTitle': 'Discard this registration?',
        'register.unsavedMessage': 'You have unsaved details.',
        'register.discard': 'Discard',
        'common:buttons.cancel': 'Cancel',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
    borderSubtle: '#eeeeee',
    error: '#e53e3e',
    success: '#22c55e',
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('heroui-native', () => {
  const React = require('react');
  const { Text, TextInput, View } = require('react-native');

  const Button = ({ children, onPress, isDisabled }: { children: React.ReactNode; onPress?: () => void; isDisabled?: boolean }) => (
    <Text onPress={isDisabled ? undefined : onPress}>{children}</Text>
  );
  Button.Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;

  const Card = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Card.Body = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  const Checkbox = ({ children, onSelectedChange, isSelected }: { children?: React.ReactNode; onSelectedChange?: (value: boolean) => void; isSelected?: boolean }) => (
    <Text onPress={() => onSelectedChange?.(!isSelected)}>{children}</Text>
  );

  return {
    Button,
    Card,
    Checkbox,
    TextField: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    Label: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    Input: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => <TextInput ref={ref} {...props} />),
    FieldError: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    Spinner: () => null,
    Surface: ({ children }: { children?: React.ReactNode }) => <View>{children}</View>,
    Text,
  };
});

jest.mock('@/lib/api/organisations', () => ({
  createOrganisation: (...args: unknown[]) => mockCreateOrganisation(...args),
}));

jest.mock('@/lib/haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success' },
}));

jest.mock('@/components/ui/AppTopBar', () => 'View');

// Stable AppToast mock — fns created inside the factory closure.
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

const { show: mockShowToast } = (jest.requireMock('@/components/ui/AppToast') as {
  useAppToast: () => { show: jest.Mock };
}).useAppToast();

import NewOrganisationScreen from './new-organisation';

describe('NewOrganisationScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateOrganisation.mockResolvedValue({ data: { id: 44, name: 'Neighbourhood Skills Network' } });
    mockShowToast.mockClear();
    Object.keys(mockNavListeners).forEach((key) => { delete mockNavListeners[key]; });
  });

  /** S4-04. Cancel, Back and gestures pop the screen via `beforeRemove`; dirty input is guarded. */
  it('asks before discarding unsaved input, and lets an untouched form leave freely', () => {
    const { getByPlaceholderText, getByText } = render(<NewOrganisationScreen />);
    expect(mockNavListeners.beforeRemove).toBeUndefined();

    fireEvent.changeText(getByPlaceholderText('Community skills network'), 'Half-typed');
    expect(mockNavListeners.beforeRemove).toBeDefined();

    // Cancel still asks the navigator to go back; the guard intercepts that pop.
    fireEvent.press(getByText('Cancel'));
    expect(mockBack).toHaveBeenCalled();

    const e = { preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } };
    mockNavListeners.beforeRemove?.(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(mockNavDispatch).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard this registration?', variant: 'danger' }));
  });

  it('renders the organisation registration form', () => {
    const { getByText, getByPlaceholderText } = render(<NewOrganisationScreen />);
    expect(getByText('Register organisation')).toBeTruthy();
    expect(getByPlaceholderText('Community skills network')).toBeTruthy();
    expect(getByPlaceholderText('contact@example.org')).toBeTruthy();
  });

  it('shows translated validation errors when required fields are missing', () => {
    const { getByText } = render(<NewOrganisationScreen />);
    fireEvent.press(getByText('Submit for review'));

    expect(getByText('Enter the organisation name.')).toBeTruthy();
    expect(getByText('Enter a description.')).toBeTruthy();
    expect(getByText('Enter a contact email.')).toBeTruthy();
    expect(getByText('Confirm you are authorised to register this organisation.')).toBeTruthy();
  });

  it('submits a valid organisation registration and opens the managed organisations route', async () => {
    const { getByText, getByPlaceholderText } = render(<NewOrganisationScreen />);

    fireEvent.changeText(getByPlaceholderText('Community skills network'), 'Neighbourhood Skills Network');
    fireEvent.changeText(getByPlaceholderText('Tell members what your organisation does and how volunteers can help.'), 'We coordinate local volunteering opportunities for neighbours.');
    fireEvent.changeText(getByPlaceholderText('contact@example.org'), 'hello@example.org');
    fireEvent.changeText(getByPlaceholderText('https://example.org'), 'https://example.org');
    fireEvent.press(getByText('I confirm I am authorised to register this organisation and the details are accurate.'));
    fireEvent.press(getByText('Submit for review'));

    await waitFor(() => expect(mockCreateOrganisation).toHaveBeenCalledWith({
      name: 'Neighbourhood Skills Network',
      description: 'We coordinate local volunteering opportunities for neighbours.',
      contact_email: 'hello@example.org',
      website: 'https://example.org',
    }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/(modals)/volunteering',
      params: { tab: 'organisations', submitted: '44' },
    }));
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Organisation submitted', variant: 'success' }));
  });
});
