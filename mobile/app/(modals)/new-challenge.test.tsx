// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockCreateIdeationChallenge = jest.fn().mockResolvedValue({ id: 14 });
const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockPush(...args),
    back: () => mockBack(),
  },
}));

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
  getIdeationChallenge: jest.fn(),
  updateIdeationChallenge: jest.fn(),
}));

jest.mock('@/lib/haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success' },
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
jest.mock('@/components/ui/EmptyState', () => 'View');
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
    submitLabel,
    secondaryLabel,
    onSubmit,
    onSecondary,
  }: {
    submitLabel: string;
    secondaryLabel?: string;
    onSubmit: () => void;
    onSecondary?: () => void;
  }) {
    return (
      <View>
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
  const Button = ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
    <Pressable onPress={onPress}>
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

describe('NewChallengeRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateIdeationChallenge.mockResolvedValue({ id: 14 });
    mockShowToast.mockClear();
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
        submission_deadline: '2026-06-15 09:00:00',
        max_ideas_per_user: 3,
      }));
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/ideation-detail', params: { id: '14' } });
    });
  });
});
