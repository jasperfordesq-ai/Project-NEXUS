// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockCreateIdeationChallenge = jest.fn().mockResolvedValue({ id: 14 });
const mockGetIdeationChallenge = jest.fn();
const mockUpdateIdeationChallenge = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockConfirm = jest.fn();
const mockNavListeners: Record<string, (e: unknown) => void> = {};
const mockNavDispatch = jest.fn();
let mockSearchParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => mockSearchParams,
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    back: () => mockBack(),
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
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/AccentIcon', () => {
  const React = require('react');
  const { View } = require('react-native');
  return () => <View testID="accent-icon" />;
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'common:buttons.cancel': 'Cancel',
        'ideation:create.eyebrow': 'New challenge',
        'ideation:create.title': 'New challenge',
        'ideation:create.subtitle': 'Invite members to submit ideas for a focused community question.',
        'ideation:create.titleLabel': 'Challenge title',
        'ideation:create.titlePlaceholder': 'What should the community solve?',
        'ideation:create.descriptionLabel': 'Description',
        'ideation:create.descriptionPlaceholder': 'Describe the problem, criteria, and useful context',
        'ideation:create.categoryLabel': 'Category',
        'ideation:create.categoryPlaceholder': 'Technology, safety, environment...',
        'ideation:create.statusLabel': 'Publishing mode',
        'ideation:create.status.open': 'Open now',
        'ideation:create.status.draft': 'Save draft',
        'ideation:create.submissionDeadlineLabel': 'Submission deadline',
        'ideation:create.votingDeadlineLabel': 'Voting deadline',
        'ideation:create.deadlinePlaceholder': '2026-06-30 17:00',
        'ideation:create.maxIdeasLabel': 'Max ideas per member',
        'ideation:create.maxIdeasPlaceholder': 'Optional',
        'ideation:create.prizeLabel': 'Prize or recognition',
        'ideation:create.prizePlaceholder': 'Optional',
        'ideation:create.reviewTitle': 'Ready to publish?',
        'ideation:create.reviewSubtitle': 'Members can submit ideas once the challenge is open.',
        'ideation:create.footerTitle': 'Create challenge',
        'ideation:create.footerSubtitle': 'Post the challenge and open it for ideas.',
        'ideation:create.submit': 'Create challenge',
        'ideation:create.saving': 'Creating...',
        'ideation:create.validationTitle': 'Check challenge details',
        'ideation:create.validationRequired': 'Add a title and description before continuing.',
        'ideation:create.validationDates': 'Use a valid date and time, such as 2026-06-30 17:00.',
        'ideation:create.validationMaxIdeas': 'Use a whole number between 1 and 50.',
        'ideation:create.failedTitle': 'Could not create challenge',
        'ideation:create.failedDescription': 'Try again in a moment.',
        'ideation:create.footerIncomplete': 'Not ready yet',
        'ideation:create.footerMissingTitle': 'Add a challenge title to continue.',
        'ideation:create.footerMissingDescription': 'Add a description to continue.',
        'ideation:create.loadFailedTitle': "Couldn't open this challenge",
        'ideation:create.unsavedTitle': 'Discard this challenge?',
        'ideation:create.unsavedMessage': 'You have unsaved details.',
        'ideation:create.discard': 'Discard',
        'ideation:challenges.load_error': 'Unable to load challenges',
        'ideation:toast.error_generic': 'Something went wrong.',
        'ideation:edit_page.page_title': 'Edit Challenge',
        'ideation:edit_page.title': 'Edit Ideation Challenge',
        'ideation:form.update': 'Update Challenge',
        'ideation:form.updating': 'Updating...',
        'common:buttons.retry': 'Retry',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: () => true }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    border: '#e5e7eb',
    onPrimary: '#ffffff',
  }),
}));

jest.mock('@/lib/api/ideation', () => ({
  createIdeationChallenge: (...args: unknown[]) => mockCreateIdeationChallenge(...args),
  getIdeationChallenge: (...args: unknown[]) => mockGetIdeationChallenge(...args),
  updateIdeationChallenge: (...args: unknown[]) => mockUpdateIdeationChallenge(...args),
}));

jest.mock('@/lib/haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success' },
  ImpactFeedbackStyle: { Light: 'light' },
}));

// Stable AppToast mock — fns created inside the factory closure.
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

const { show: mockShowToast } = (jest.requireMock('@/components/ui/AppToast') as {
  useAppToast: () => { show: jest.Mock };
}).useAppToast();

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppTopBar', () => 'View');

jest.mock('@/components/ui/Input', () => {
  const React = require('react');
  const { Text, TextInput, View } = require('react-native');
  return function MockInput({
    label,
    value,
    onChangeText,
    placeholder,
  }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    placeholder: string;
  }) {
    return (
      <View>
        <Text>{label}</Text>
        <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} />
      </View>
    );
  };
});
jest.mock('@/components/ui/FormActionFooter', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return function MockFormActionFooter({
    title,
    subtitle,
    submitLabel,
    secondaryLabel,
    isDisabled,
    onSubmit,
    onSecondary,
  }: {
    title: string;
    subtitle: string;
    submitLabel: string;
    secondaryLabel?: string;
    isDisabled?: boolean;
    onSubmit: () => void;
    onSecondary?: () => void;
  }) {
    return (
      <View>
        <Text testID="footer-title">{title}</Text>
        <Text testID="footer-subtitle">{subtitle}</Text>
        <View testID="footer-submit" accessibilityState={{ disabled: !!isDisabled }} />
        {secondaryLabel ? (
          <Pressable accessibilityRole="button" onPress={onSecondary}>
            <Text>{secondaryLabel}</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={onSubmit}>
          <Text>{submitLabel}</Text>
        </Pressable>
      </View>
    );
  };
});

jest.mock('heroui-native', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  const Button = ({ children, onPress, accessibilityLabel, accessibilityState }: { children: React.ReactNode; onPress?: () => void; accessibilityLabel?: string; accessibilityState?: Record<string, unknown> }) => (
    <Pressable onPress={onPress} accessibilityLabel={accessibilityLabel} accessibilityState={accessibilityState}>
      <View>{children}</View>
    </Pressable>
  );
  Button.Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  const Card = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Card.Body = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  const Chip = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Chip.Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  return { Button, Card, Chip, Text };
});

import NewChallengeRoute from './new-challenge';
import { eventIsoToLocalInput, eventLocalInputToIso, localEventTimeZone } from '@/lib/utils/eventDateTime';

const DEVICE_ZONE = localEventTimeZone();

describe('NewChallengeRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = {};
    mockCreateIdeationChallenge.mockResolvedValue({ id: 14 });
    mockGetIdeationChallenge.mockReset();
    mockUpdateIdeationChallenge.mockReset().mockResolvedValue({ id: 14 });
    mockShowToast.mockClear();
    Object.keys(mockNavListeners).forEach((key) => { delete mockNavListeners[key]; });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps the native create challenge frame full height with an explicit background', () => {
    const { getByTestId } = render(<NewChallengeRoute />);
    const screen = getByTestId('new-challenge-screen');
    const scroll = getByTestId('new-challenge-scroll');

    expect(screen.props.style).toEqual(expect.objectContaining({
      flex: 1,
      backgroundColor: '#ffffff',
    }));
    expect(scroll.props.style).toEqual(expect.objectContaining({
      flex: 1,
      backgroundColor: '#ffffff',
    }));
    expect(scroll.props.contentContainerStyle).toEqual(expect.objectContaining({
      flexGrow: 1,
      backgroundColor: '#ffffff',
      paddingBottom: 120,
    }));
  });

  it('requires a title and description before creating a challenge', async () => {
    const { getByText } = render(<NewChallengeRoute />);

    fireEvent.press(getByText('Create challenge'));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Check challenge details', description: 'Add a title and description before continuing.', variant: 'warning' }));
    });
    expect(mockCreateIdeationChallenge).not.toHaveBeenCalled();
  });

  it('creates a challenge and opens the native challenge detail page', async () => {
    const { getAllByPlaceholderText, getAllByText, getByPlaceholderText } = render(<NewChallengeRoute />);

    fireEvent.changeText(getByPlaceholderText('What should the community solve?'), 'Community welcome challenge');
    fireEvent.changeText(
      getByPlaceholderText('Describe the problem, criteria, and useful context'),
      'Gather practical ideas for helping new members feel welcome.',
    );
    fireEvent.changeText(getByPlaceholderText('Technology, safety, environment...'), 'Community');
    fireEvent.changeText(getAllByPlaceholderText('2026-06-30 17:00')[0], '2026-06-15 09:00');
    fireEvent.changeText(getAllByPlaceholderText('Optional')[0], '3');
    const submitButtons = getAllByText('Create challenge');
    fireEvent.press(submitButtons[submitButtons.length - 1]);

    await waitFor(() => {
      expect(mockCreateIdeationChallenge).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Community welcome challenge',
        description: 'Gather practical ideas for helping new members feel welcome.',
        category: 'Community',
        status: 'open',
        // S4-13: the typed wall-clock deadline is sent as the matching instant in the device zone.
        submission_deadline: eventLocalInputToIso('2026-06-15T09:00', DEVICE_ZONE),
        max_ideas_per_user: 3,
      }));
    });

    // S4-14: `replace`, so Back cannot return to a form whose contents are already posted.
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith({ pathname: '/(modals)/ideation-detail', params: { id: '14' } });
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  /**
   * 🔴 S4-13. The server's UTC string was sliced as if it were local and saved back naive, so
   * every save moved the deadline by the UTC offset. Round-tripping must be lossless.
   */
  it('shows a stored deadline in the device zone and saves it back as the same instant', async () => {
    mockSearchParams = { id: '14', mode: 'edit' };
    const storedDeadline = '2026-06-15T09:00:00.000Z';
    mockGetIdeationChallenge.mockResolvedValue({
      id: 14, title: 'Community welcome challenge', description: 'Gather practical ideas for helping new members feel welcome.',
      category: null, prize_description: null, submission_deadline: storedDeadline, voting_deadline: null, max_ideas_per_user: null,
    });
    const expectedInput = eventIsoToLocalInput(storedDeadline, DEVICE_ZONE).replace('T', ' ');

    const { getByDisplayValue, getByText } = render(<NewChallengeRoute />);
    await waitFor(() => expect(getByDisplayValue(expectedInput)).toBeTruthy());

    fireEvent.press(getByText('Update Challenge'));
    await waitFor(() => expect(mockUpdateIdeationChallenge).toHaveBeenCalledWith(14, expect.objectContaining({
      submission_deadline: new Date(storedDeadline).toISOString(),
    })));
  });

  /** 🔴 S4-14. The footer said "Ready" over an empty form; it now says what is missing and is disabled. */
  it('derives the footer copy and disabled state from the required fields', () => {
    const { getByTestId, getByPlaceholderText } = render(<NewChallengeRoute />);
    expect(getByTestId('footer-title').props.children).toBe('Not ready yet');
    expect(getByTestId('footer-subtitle').props.children).toBe('Add a challenge title to continue.');
    expect(getByTestId('footer-submit').props.accessibilityState.disabled).toBe(true);

    fireEvent.changeText(getByPlaceholderText('What should the community solve?'), 'Community welcome challenge');
    expect(getByTestId('footer-subtitle').props.children).toBe('Add a description to continue.');

    fireEvent.changeText(getByPlaceholderText('Describe the problem, criteria, and useful context'), 'Gather practical ideas.');
    expect(getByTestId('footer-title').props.children).toBe('Ready to publish?');
    expect(getByTestId('footer-subtitle').props.children).toBe('Members can submit ideas once the challenge is open.');
    expect(getByTestId('footer-submit').props.accessibilityState.disabled).toBe(false);
  });

  /** 🔴 S4-03. A failed hydration must not leave a live "Update" button over blank fields. */
  it('withholds the form when the challenge cannot be loaded and offers a retry', async () => {
    mockSearchParams = { id: '14', mode: 'edit' };
    mockGetIdeationChallenge.mockRejectedValueOnce(new Error('offline'));

    const { getByText, queryByText, getByDisplayValue } = render(<NewChallengeRoute />);
    await waitFor(() => expect(getByText("Couldn't open this challenge")).toBeTruthy());
    expect(queryByText('Update Challenge')).toBeNull();

    mockGetIdeationChallenge.mockResolvedValueOnce({ id: 14, title: 'Loaded title', description: 'Loaded description', category: null, prize_description: null, submission_deadline: null, voting_deadline: null, max_ideas_per_user: null });
    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(getByDisplayValue('Loaded title')).toBeTruthy());
    expect(mockUpdateIdeationChallenge).not.toHaveBeenCalled();
  });

  /** S4-04. Dirty input is guarded on Back / Cancel / gestures. */
  it('asks before discarding unsaved input', () => {
    const { getByPlaceholderText } = render(<NewChallengeRoute />);
    expect(mockNavListeners.beforeRemove).toBeUndefined();
    fireEvent.changeText(getByPlaceholderText('What should the community solve?'), 'Half-typed');
    expect(mockNavListeners.beforeRemove).toBeDefined();

    const e = { preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } };
    mockNavListeners.beforeRemove?.(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(mockNavDispatch).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard this challenge?' }));
  });

  /** S4-22. The selected publishing mode paints its icon with the accent foreground and announces its state. */
  it('uses the accent foreground for the selected publishing mode', () => {
    const { getByLabelText, getAllByTestId } = render(<NewChallengeRoute />);
    expect(getByLabelText('Open now').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(getAllByTestId('accent-icon')).toHaveLength(1);
    fireEvent.press(getByLabelText('Save draft'));
    expect(getByLabelText('Save draft').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
  });
});
