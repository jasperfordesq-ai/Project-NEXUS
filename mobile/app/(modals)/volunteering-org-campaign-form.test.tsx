// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiResponseError } from '@/lib/api/client';

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));

const mockBack = jest.fn();
let mockRouteParams: Record<string, string> = { id: '114' };

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: () => mockBack(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => mockRouteParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const o = opts ?? {};
      const map: Record<string, string> = {
        'campaignForm.newTitle': 'New campaign',
        'campaignForm.editTitle': 'Edit campaign',
        'campaignForm.eyebrow': 'Fundraising',
        'campaignForm.subtitle': 'The campaign goes live as soon as you save it.',
        'campaignForm.editSubtitle': 'Changes are recorded in the history.',
        'campaignForm.section': 'Campaign details',
        'campaignForm.titleLabel': 'Title',
        'campaignForm.titlePlaceholder': 'What are you raising money for?',
        'campaignForm.descriptionLabel': 'Description',
        'campaignForm.descriptionPlaceholder': 'Tell members what their gift will do.',
        'campaignForm.startDateLabel': 'Start date',
        'campaignForm.endDateLabel': 'End date',
        'campaignForm.datePlaceholder': 'YYYY-MM-DD',
        'campaignForm.goalLabel': `Goal (${String(o.currency ?? '')})`,
        'campaignForm.goalPlaceholder': 'Amount',
        'campaignForm.required': 'Fill in the title, both dates and a goal.',
        'campaignForm.invalidDate': 'Enter dates as YYYY-MM-DD.',
        'campaignForm.endBeforeStart': 'The end date must be on or after the start date.',
        'campaignForm.invalidGoal': 'Enter a goal greater than zero.',
        'campaignForm.save': 'Save campaign',
        'campaignForm.saved': 'Campaign saved.',
        'campaignForm.saveFailed': 'Could not save this campaign.',
        'campaignForm.loadFailed': 'Could not load this campaign.',
        'campaignForm.notFound': 'This campaign no longer exists.',
        'campaignForm.reviewTitle': 'Ready to save?',
        'campaignForm.reviewSubtitle': 'Members can give to it straight away.',
        'campaignForm.reviewMissing': 'Fill in the title, both dates and a goal before saving.',
        'campaignForm.unsavedTitle': 'Discard?',
        'campaignForm.unsavedMessage': 'Unsaved.',
        'campaignForm.discard': 'Discard',
        'common:back': 'Back',
        'common:buttons.cancel': 'Cancel',
        'common:buttons.retry': 'Retry',
        'common:errors.alertTitle': 'Error',
        'common:errors.notFound': 'Not found.',
        'common:errors.notAvailableTitle': 'Not available to you',
        'common:errors.notAvailableHint': 'This may have been removed.',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/lib/haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { id: 2, slug: 'hour-timebank', currency: 'GBP' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#fff', surface: '#f8f9fa', text: '#111', textSecondary: '#666', textMuted: '#999', error: '#dc2626', success: '#16a34a', warning: '#f59e0b', border: '#ddd' }),
}));
jest.mock('@/components/ui/useConfirm', () => ({ useConfirm: () => ({ confirm: jest.fn(), confirmDialog: null }) }));
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});
const { show: mockShowToast } = (jest.requireMock('@/components/ui/AppToast') as { useAppToast: () => { show: jest.Mock } }).useAppToast();
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

jest.mock('@/lib/api/volunteeringOrganiser', () => {
  const actual = jest.requireActual('@/lib/api/volunteeringOrganiser');
  return { ...actual, createOrganisationCampaign: jest.fn(), updateOrganisationCampaign: jest.fn(), getOrganisationCampaigns: jest.fn() };
});

import { createOrganisationCampaign, getOrganisationCampaigns, updateOrganisationCampaign } from '@/lib/api/volunteeringOrganiser';
import CampaignForm from './volunteering-org-campaign-form';

function fill(screen: ReturnType<typeof render>, values: Partial<Record<'title' | 'start' | 'end' | 'goal', string>>) {
  if (values.title !== undefined) fireEvent.changeText(screen.getByLabelText('Title'), values.title);
  if (values.start !== undefined) fireEvent.changeText(screen.getByLabelText('Start date'), values.start);
  if (values.end !== undefined) fireEvent.changeText(screen.getByLabelText('End date'), values.end);
  if (values.goal !== undefined) fireEvent.changeText(screen.getByLabelText('Goal (GBP)'), values.goal);
}

describe('CampaignForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { id: '114' };
    jest.mocked(createOrganisationCampaign).mockResolvedValue({ data: { id: 12 } } as never);
    jest.mocked(updateOrganisationCampaign).mockResolvedValue({ data: { success: true } });
  });

  it('labels the goal in the community\'s currency and keeps Save disabled until the required fields are filled', () => {
    const screen = render(<CampaignForm />);
    expect(screen.getByLabelText('Goal (GBP)')).toBeTruthy();
    expect(screen.getByTestId('footer-submit').props.accessibilityState.disabled).toBe(true);
    fill(screen, { title: 'Winter appeal', start: '2026-11-01', end: '2026-12-01', goal: '500' });
    expect(screen.getByTestId('footer-submit').props.accessibilityState.disabled).toBe(false);
  });

  it.each([
    ['an end before the start', { title: 'Winter appeal', start: '2026-12-01', end: '2026-11-01', goal: '500' }, 'The end date must be on or after the start date.'],
    ['a goal of zero', { title: 'Winter appeal', start: '2026-11-01', end: '2026-12-01', goal: '0' }, 'Enter a goal greater than zero.'],
    ['a date that is not a date', { title: 'Winter appeal', start: '2026-13-01', end: '2026-12-01', goal: '5' }, 'Enter dates as YYYY-MM-DD.'],
  ])('refuses %s before anything is sent', async (_label, values, message) => {
    const screen = render(<CampaignForm />);
    fill(screen, values);
    fireEvent.press(screen.getByTestId('footer-submit'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: message, variant: 'warning' })));
    expect(createOrganisationCampaign).not.toHaveBeenCalled();
  });

  it('🔴 creates with the website\'s body, never sending an organisation id, and accepts a comma decimal', async () => {
    const screen = render(<CampaignForm />);
    fill(screen, { title: ' Winter appeal ', start: '2026-11-01', end: '2026-12-01', goal: '250,50' });
    fireEvent.changeText(screen.getByLabelText('Description'), 'Coats for the winter.');
    fireEvent.press(screen.getByTestId('footer-submit'));

    await waitFor(() => expect(createOrganisationCampaign).toHaveBeenCalledWith(114, {
      title: 'Winter appeal',
      description: 'Coats for the winter.',
      start_date: '2026-11-01',
      end_date: '2026-12-01',
      goal_amount: 250.5,
    }));
    expect(jest.mocked(createOrganisationCampaign).mock.calls[0]![1]).not.toHaveProperty('organization_id');
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('loads the campaign being edited from the list and sends the update by id', async () => {
    mockRouteParams = { id: '114', campaignId: '9' };
    jest.mocked(getOrganisationCampaigns).mockResolvedValueOnce({
      data: { items: [{ id: 9, title: 'Winter appeal', description: 'Coats', start_date: '2026-10-01 00:00:00', end_date: '2026-12-01 00:00:00', goal_amount: '500.00', raised_amount: 120, is_active: true, status: 'active' }] },
    });
    const screen = render(<CampaignForm />);
    expect(screen.getByTestId('campaign-form-loading')).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('Title').props.value).toBe('Winter appeal'));
    expect(screen.getByLabelText('Start date').props.value).toBe('2026-10-01');
    expect(screen.getByLabelText('Goal (GBP)').props.value).toBe('500');

    fill(screen, { goal: '600' });
    fireEvent.press(screen.getByTestId('footer-submit'));
    await waitFor(() => expect(updateOrganisationCampaign).toHaveBeenCalledWith(114, 9, expect.objectContaining({ title: 'Winter appeal', goal_amount: 600 })));
    expect(createOrganisationCampaign).not.toHaveBeenCalled();
  });

  it('shows the server\'s refusal in its own words', async () => {
    jest.mocked(createOrganisationCampaign).mockRejectedValueOnce(new ApiResponseError(422, 'Your organisation is not approved yet.', undefined, 'VALIDATION_ERROR'));
    const screen = render(<CampaignForm />);
    fill(screen, { title: 'Winter appeal', start: '2026-11-01', end: '2026-12-01', goal: '500' });
    fireEvent.press(screen.getByTestId('footer-submit'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Your organisation is not approved yet.', variant: 'danger' })));
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('never shows an empty form under a live Save when the campaign could not be loaded', async () => {
    mockRouteParams = { id: '114', campaignId: '9' };
    jest.mocked(getOrganisationCampaigns).mockRejectedValueOnce(new ApiResponseError(403, 'Forbidden', undefined, 'FORBIDDEN'));
    const screen = render(<CampaignForm />);
    await waitFor(() => expect(screen.getByTestId('campaign-form-load-failed')).toBeTruthy());
    expect(screen.queryByTestId('footer-submit')).toBeNull();
  });
});
