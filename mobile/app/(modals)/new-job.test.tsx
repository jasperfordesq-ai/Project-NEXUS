// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));

const mockCreateJob = jest.fn().mockResolvedValue({ data: { id: 301 } });
const mockGetJobDetail = jest.fn();
const mockGenerateJobDescription = jest.fn();
const mockReplace = jest.fn();
let mockSearchParams: Record<string, string> = {};
let mockUserId = 21;
let mockTenantId = 2;
const mockDraftGuard = jest.fn();
jest.mock('@/lib/hooks/useUnsavedChangesGuard', () => ({ useUnsavedChangesGuard: (options: unknown) => mockDraftGuard(options) }));

// The form guards against a stray Back (audit 2026-09-06); the confirmation is inert here.
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (options: { onConfirm: () => void }) => options.onConfirm(),
    confirmDialog: null,
  }),
}));

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { replace: (...args: unknown[]) => mockReplace(...args), back: jest.fn() },
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'create.eyebrow': 'New role',
        'create.title': 'Create Job',
        'create.editTitle': 'Edit Job',
        'create.subtitle': 'Post a role.',
        'create.editSubtitle': 'Update the role details.',
        'create.titleLabel': 'Title',
        'create.titlePlaceholder': 'Role title',
        'create.descriptionLabel': 'Description',
        'create.descriptionPlaceholder': 'Describe the role, expectations, and next steps.',
        'create.generateDescription': 'Generate with AI',
        'create.generatingDescription': 'Generating...',
        'create.generateTitleRequired': 'Add a title before generating a description.',
        'create.generateDescriptionFailed': 'Could not generate a description.',
        'create.typeLabel': 'Type',
        'create.commitmentLabel': 'Commitment',
        'create.locationLabel': 'Location',
        'create.locationPlaceholder': 'Where is the role based?',
        'create.categoryLabel': 'Category',
        'create.categoryPlaceholder': 'Optional category',
        'create.skillsLabel': 'Skills',
        'create.skillsPlaceholder': 'Comma-separated skills',
        'create.hoursLabel': 'Hours per week',
        'create.hoursPlaceholder': 'Optional hours',
        'create.creditsLabel': 'Time credits',
        'create.creditsPlaceholder': 'Optional credits',
        'create.deadlineLabel': 'Deadline',
        'create.deadlinePlaceholder': 'YYYY-MM-DD',
        'create.contactEmailLabel': 'Contact email',
        'create.contactEmailPlaceholder': 'name@example.org',
        'create.contactPhoneLabel': 'Contact phone',
        'create.contactPhonePlaceholder': '+1 555 123 4567',
        'create.salaryMinLabel': 'Salary minimum',
        'create.salaryMaxLabel': 'Salary maximum',
        'create.salaryPlaceholder': 'Optional amount',
        'create.salaryTypeLabel': 'Pay type',
        'create.salaryType.hourly': 'Hourly',
        'create.salaryType.monthly': 'Monthly',
        'create.salaryType.annual': 'Annual',
        'create.salaryCurrencyLabel': 'Currency',
        'create.salaryCurrencyPlaceholder': 'EUR',
        'create.salaryNegotiable': 'Salary negotiable',
        'create.blindHiring': 'Enable blind hiring',
        'create.taglineLabel': 'Company tagline',
        'create.taglinePlaceholder': 'What makes this team a good place to work?',
        'create.videoUrlLabel': 'Culture video URL',
        'create.videoUrlPlaceholder': 'https://example.org/video',
        'create.companySizeLabel': 'Company size',
        'create.companySize.1-10': '1-10',
        'create.companySize.11-50': '11-50',
        'create.companySize.51-200': '51-200',
        'create.companySize.201-500': '201-500',
        'create.companySize.500+': '500+',
        'create.benefitsLabel': 'Benefits and perks',
        'create.benefitsPlaceholder': 'Comma-separated benefits',
        'create.remote': 'Remote role',
        'create.reviewTitle': 'Ready to publish?',
        'create.reviewSubtitle': 'Review first.',
        'create.editReviewTitle': 'Ready to update?',
        'create.editReviewSubtitle': 'Save your changes.',
        'create.submit': 'Create job',
        'create.updateSubmit': 'Update job',
        'create.validationTitle': 'Check job details',
        'create.deadlinePast': 'Deadline must be a future date.',
        'create.salaryRangeInvalid': 'Minimum salary cannot exceed maximum salary.',
        'create.salaryRequired': 'Salary range required. You may mark salary negotiable to omit it.',
        'create.loadFailed': 'Could not load job.',
        'create.loadFailedTitle': 'This job could not be loaded for editing',
        'common:errors.notAvailableTitle': 'Not available to you',
        'common:errors.notAvailableHint': 'This may have been removed, or it may not be shared with you.',
        'common:buttons.retry': 'Retry',
        'create.failedTitle': 'Job not created',
        'create.failedDescription': 'We could not create the job.',
        'create.editFailedTitle': 'Job not updated',
        'create.editFailedDescription': 'We could not update the job.',
        'common:errors.alertTitle': 'Something went wrong',
        'filters.type.paid': 'Paid',
        'filters.type.volunteer': 'Volunteer',
        'filters.type.timebank': 'Timebank',
        'filters.commitment.flexible': 'Flexible',
        'filters.commitment.part_time': 'Part Time',
        'filters.commitment.full_time': 'Full Time',
        'filters.commitment.one_off': 'One-off',
        'common:back': 'Back',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { id: mockTenantId, slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#6366f1' }));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mockUserId } }) }));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
  }),
}));
jest.mock('@/lib/api/jobs', () => ({
  createJob: (...args: unknown[]) => mockCreateJob(...args),
  generateJobDescription: (...args: unknown[]) => mockGenerateJobDescription(...args),
  getJobDetail: (...args: unknown[]) => mockGetJobDetail(...args),
  updateJob: jest.fn().mockResolvedValue({ data: { id: 301 } }),
}));
jest.mock('@/lib/haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});
jest.mock('@/components/ui/FormActionFooter', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return function MockFormActionFooter({ submitLabel, isSubmitting, isDisabled, onSubmit }: { submitLabel: string; isSubmitting: boolean; isDisabled?: boolean; onSubmit: () => void }) {
    const disabled = isSubmitting || isDisabled;
    return (
      <View>
        <Pressable accessibilityRole="button" accessibilityLabel={submitLabel} disabled={disabled} accessibilityState={{ disabled }} onPress={onSubmit}>
          <Text>{submitLabel}</Text>
        </Pressable>
      </View>
    );
  };
});
jest.mock('heroui-native', () => {
  const React = require('react');
  const { Pressable, Text, TextInput, View } = require('react-native');
  const Button = ({ children, onPress, isDisabled, accessibilityState, ...props }: { children: React.ReactNode; onPress?: () => void; isDisabled?: boolean; accessibilityState?: Record<string, unknown>; [key: string]: unknown }) => (
    <Pressable {...props} disabled={isDisabled} accessibilityState={{ ...accessibilityState, disabled: Boolean(isDisabled) }} onPress={onPress}>
      <View>{children}</View>
    </Pressable>
  );
  Button.Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  const Card = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Card.Body = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  const TagGroupContext = React.createContext(null);
  const TagGroup = ({ children, onSelectionChange }: { children: React.ReactNode; onSelectionChange?: (keys: Set<string | number>) => void }) => (
    <TagGroupContext.Provider value={{ onSelectionChange }}>
      <View>{children}</View>
    </TagGroupContext.Provider>
  );
  TagGroup.List = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  TagGroup.Item = ({ children, id }: { children: React.ReactNode; id: string | number }) => {
    const ctx = React.useContext(TagGroupContext);
    return (
      <Pressable onPress={() => ctx?.onSelectionChange?.(new Set([id]))}>
        <View>{children}</View>
      </Pressable>
    );
  };
  TagGroup.ItemLabel = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  return {
    Button,
    Card,
    Text,
    TextField: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    Label: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    Input: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => <TextInput ref={ref} {...props} />),
    FieldError: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    TagGroup,
  };
});

import NewJobRoute from './new-job';
import { updateJob } from '@/lib/api/jobs';
import { ApiResponseError } from '@/lib/api/client';
import { useAppToast } from '@/components/ui/AppToast';

const showToast = useAppToast().show as jest.Mock;

function accessibilityStateFor(node: { parent?: unknown; props?: { accessibilityState?: Record<string, unknown> } } | null) {
  let current = node as typeof node;
  while (current) {
    if (current.props?.accessibilityState) return current.props.accessibilityState;
    current = current.parent as typeof node;
  }
  return undefined;
}

describe('NewJobRoute', () => {
  it('retains a rejected job draft and allows retry with the same values', async () => {
    mockCreateJob.mockRejectedValueOnce(new ApiResponseError(422, 'Please review the role.'));
    const screen = render(<NewJobRoute />);
    fireEvent.changeText(screen.getByPlaceholderText('Role title'), 'Garden coordinator');
    fireEvent.changeText(screen.getByPlaceholderText('Describe the role, expectations, and next steps.'), 'Coordinate weekly sessions.');
    fireEvent.changeText(screen.getByPlaceholderText('Where is the role based?'), 'Riverside');
    await act(async () => { fireEvent.press(screen.getByText('Create job')); });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Garden coordinator')).toBeTruthy();
    expect(screen.getByDisplayValue('Riverside')).toBeTruthy();
    expect(mockDraftGuard.mock.calls.at(-1)?.[0].isDirty).toBe(true);
    await act(async () => { fireEvent.press(screen.getByText('Create job')); });
    expect(mockCreateJob).toHaveBeenCalledTimes(2);
    expect(mockCreateJob.mock.calls[1][0]).toEqual(mockCreateJob.mock.calls[0][0]);
    expect(mockReplace).toHaveBeenCalled();
  });
  it('reuses the creation key when the result is unknown and a retry confirms the job', async () => {
    mockCreateJob.mockRejectedValueOnce(new ApiResponseError(0, 'The request result is unknown.'));
    const screen = render(<NewJobRoute />);
    fireEvent.changeText(screen.getByPlaceholderText('Role title'), 'Response-loss coordinator');
    fireEvent.changeText(screen.getByPlaceholderText('Describe the role, expectations, and next steps.'), 'Coordinate the response-loss test.');

    await act(async () => { fireEvent.press(screen.getByText('Create job')); });
    const firstPayload = mockCreateJob.mock.calls[0][0] as { idempotency_key?: string };
    expect(firstPayload.idempotency_key).toEqual(expect.any(String));
    expect(firstPayload.idempotency_key!.length).toBeGreaterThanOrEqual(8);
    expect(mockReplace).not.toHaveBeenCalled();

    await act(async () => { fireEvent.press(screen.getByText('Create job')); });
    const retryPayload = mockCreateJob.mock.calls[1][0] as { idempotency_key?: string };
    expect(retryPayload.idempotency_key).toBe(firstPayload.idempotency_key);
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/(modals)/job-detail', params: { id: '301' } });
  });
  it('uses a new creation key after the rejected draft changes', async () => {
    mockCreateJob.mockRejectedValueOnce(new ApiResponseError(422, 'Please review the role.'));
    const screen = render(<NewJobRoute />);
    fireEvent.changeText(screen.getByPlaceholderText('Role title'), 'First title');
    fireEvent.changeText(screen.getByPlaceholderText('Describe the role, expectations, and next steps.'), 'A complete description.');
    await act(async () => { fireEvent.press(screen.getByText('Create job')); });
    const firstKey = mockCreateJob.mock.calls[0][0].idempotency_key;

    fireEvent.changeText(screen.getByDisplayValue('First title'), 'Corrected title');
    await act(async () => { fireEvent.press(screen.getByText('Create job')); });
    expect(mockCreateJob.mock.calls[1][0].idempotency_key).not.toBe(firstKey);
  });
  it('does not navigate a replacement account when the previous account creation finishes', async () => {
    let resolve!: (value: unknown) => void;
    mockCreateJob.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const screen = render(<NewJobRoute />);
    fireEvent.changeText(screen.getByPlaceholderText('Role title'), 'Original account role');
    fireEvent.changeText(screen.getByPlaceholderText('Describe the role, expectations, and next steps.'), 'Created by the original account.');
    fireEvent.press(screen.getByText('Create job'));
    await waitFor(() => expect(mockCreateJob).toHaveBeenCalledTimes(1));

    mockUserId = 99;
    screen.rerender(<NewJobRoute />);
    expect(screen.queryByDisplayValue('Original account role')).toBeNull();
    await act(async () => { resolve({ data: { id: 654 } }); });

    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Role title')).toHaveProp('value', '');
  });
  it('dispatches one creation for rapid repeated submit actions', async () => {
    const screen = render(<NewJobRoute />);
    fireEvent.changeText(screen.getByPlaceholderText('Role title'), 'Garden coordinator');
    fireEvent.changeText(screen.getByPlaceholderText('Describe the role, expectations, and next steps.'), 'Coordinate weekly garden sessions.');
    await act(async () => {
      fireEvent.press(screen.getByText('Create job'));
      fireEvent.press(screen.getByText('Create job'));
    });
    expect(mockCreateJob).toHaveBeenCalledTimes(1);
  });
  it('locks the submitted draft while creation is pending and restores it after failure', async () => {
    let reject!: (reason: unknown) => void;
    mockCreateJob.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const screen = render(<NewJobRoute />);
    const title = screen.getByPlaceholderText('Role title');
    const description = screen.getByPlaceholderText('Describe the role, expectations, and next steps.');
    fireEvent.changeText(title, 'Garden coordinator');
    fireEvent.changeText(description, 'Coordinate weekly garden sessions.');

    fireEvent.press(screen.getByRole('button', { name: 'Create job' }));
    await waitFor(() => expect(mockCreateJob).toHaveBeenCalledTimes(1));

    expect(screen.getByDisplayValue('Garden coordinator').props.isDisabled).toBe(true);
    expect(screen.getByDisplayValue('Coordinate weekly garden sessions.').props.isDisabled).toBe(true);
    expect(screen.getByLabelText('Remote role').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText('Paid').props.accessibilityState.disabled).toBe(true);
    expect(accessibilityStateFor(screen.getByText('Generate with AI'))?.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Create job' }).props.accessibilityState.disabled).toBe(true);

    fireEvent.press(screen.getByLabelText('Remote role'));
    fireEvent.press(screen.getByLabelText('Paid'));
    fireEvent.press(screen.getByText('Generate with AI'));
    fireEvent.press(screen.getByRole('button', { name: 'Create job' }));
    expect(mockCreateJob).toHaveBeenCalledTimes(1);
    expect(mockGenerateJobDescription).not.toHaveBeenCalled();

    await act(async () => { reject(new ApiResponseError(422, 'Please review the role.')); });
    expect(screen.getByDisplayValue('Garden coordinator').props.isDisabled).toBe(false);
    expect(screen.getByLabelText('Remote role').props.accessibilityState.disabled).toBe(false);
    expect(mockDraftGuard.mock.calls.at(-1)?.[0].isDirty).toBe(true);
  });
  it('preserves employer edits made while an AI description is pending', async () => {
    let resolve!: (value: unknown) => void;
    mockGenerateJobDescription.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const screen = render(<NewJobRoute />);
    fireEvent.changeText(screen.getByPlaceholderText('Role title'), 'Community coordinator');
    fireEvent.press(screen.getByText('Generate with AI'));
    fireEvent.changeText(screen.getByPlaceholderText('Role title'), 'Updated role title');
    fireEvent.changeText(screen.getByPlaceholderText('Describe the role, expectations, and next steps.'), 'My own carefully written description');
    await act(async () => { resolve({ data: { description: 'Outdated generated copy' } }); });
    expect(screen.queryByDisplayValue('Outdated generated copy')).toBeNull();
    expect(screen.getByDisplayValue('My own carefully written description')).toBeTruthy();
  });
  it('loads a new edit target instead of retaining the previous job draft', async () => {
    mockSearchParams = { id: '301' };
    mockGetJobDetail.mockResolvedValueOnce({ data: { id: 301, title: 'First job', description: 'First description' } });
    const screen = render(<NewJobRoute />);
    await waitFor(() => expect(screen.getByDisplayValue('First job')).toBeTruthy());
    fireEvent.changeText(screen.getByDisplayValue('First job'), 'First job draft');
    mockGetJobDetail.mockResolvedValueOnce({ data: { id: 302, title: 'Second job', description: 'Second description' } });
    mockSearchParams = { id: '302' };
    screen.rerender(<NewJobRoute />);
    await waitFor(() => expect(screen.getByDisplayValue('Second job')).toBeTruthy());
    expect(screen.queryByDisplayValue('First job draft')).toBeNull();
    expect(mockDraftGuard.mock.calls.at(-1)?.[0].isDirty).toBe(false);
  });
  it('tracks a location-only draft and clearing it back to the initial value', () => {
    const screen = render(<NewJobRoute />);
    expect(mockDraftGuard.mock.calls.at(-1)?.[0].isDirty).toBe(false);
    fireEvent.changeText(screen.getByPlaceholderText('Where is the role based?'), 'Riverside');
    expect(mockDraftGuard.mock.calls.at(-1)?.[0].isDirty).toBe(true);
    fireEvent.changeText(screen.getByPlaceholderText('Where is the role based?'), '');
    expect(mockDraftGuard.mock.calls.at(-1)?.[0].isDirty).toBe(false);
  });
  beforeEach(() => {
    showToast.mockClear();
    mockSearchParams = {};
    mockUserId = 21;
    mockTenantId = 2;
    mockCreateJob.mockClear();
    mockGenerateJobDescription.mockReset();
    mockGenerateJobDescription.mockResolvedValue({ data: { description: 'AI generated role description.' } });
    mockGetJobDetail.mockReset();
    (updateJob as jest.Mock).mockClear();
    mockReplace.mockClear();
  });

  it('blocks paid roles without salary transparency unless negotiable', async () => {
    const { getByPlaceholderText, getByText } = render(<NewJobRoute />);

    fireEvent.changeText(getByPlaceholderText('Role title'), 'Community coordinator');
    fireEvent.changeText(getByPlaceholderText('Describe the role, expectations, and next steps.'), 'Coordinate local sessions and support volunteers.');
    fireEvent.press(getByText('Paid'));
    fireEvent.press(getByText('Create job'));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith({ title: 'Check job details', description: 'Salary range required. You may mark salary negotiable to omit it.', variant: 'warning' });
    });
    expect(mockCreateJob).not.toHaveBeenCalled();
  });

  it('generates a role description from the current title, skills, type, and commitment', async () => {
    const { getByDisplayValue, getByPlaceholderText, getByText } = render(<NewJobRoute />);

    fireEvent.changeText(getByPlaceholderText('Role title'), 'Community coordinator');
    fireEvent.press(getByText('Paid'));
    fireEvent.press(getByText('Part Time'));
    fireEvent.changeText(getByPlaceholderText('Comma-separated skills'), 'Planning, Support');
    fireEvent.press(getByText('Generate with AI'));

    await waitFor(() => {
      expect(mockGenerateJobDescription).toHaveBeenCalledWith({
        title: 'Community coordinator',
        skills: ['Planning', 'Support'],
        type: 'paid',
        commitment: 'part_time',
      });
    });
    expect(getByDisplayValue('AI generated role description.')).toBeTruthy();
  });

  it('disables description generation until a title is present', () => {
    const { getByText } = render(<NewJobRoute />);

    expect(accessibilityStateFor(getByText('Generate with AI'))?.disabled).toBe(true);
    fireEvent.press(getByText('Generate with AI'));
    expect(mockGenerateJobDescription).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('allows paid roles without salary values when salary is negotiable', async () => {
    const { getByPlaceholderText, getByText } = render(<NewJobRoute />);

    fireEvent.changeText(getByPlaceholderText('Role title'), 'Community coordinator');
    fireEvent.changeText(getByPlaceholderText('Describe the role, expectations, and next steps.'), 'Coordinate local sessions and support volunteers.');
    fireEvent.press(getByText('Paid'));
    fireEvent.press(getByText('Salary negotiable'));
    fireEvent.press(getByText('Create job'));

    await waitFor(() => {
      expect(mockCreateJob).toHaveBeenCalledWith(expect.objectContaining({
        type: 'paid',
        salary_min: null,
        salary_max: null,
        salary_negotiable: true,
      }));
    });
  });

  it('blocks salary ranges where minimum exceeds maximum', async () => {
    const { getAllByPlaceholderText, getByPlaceholderText, getByText } = render(<NewJobRoute />);

    fireEvent.changeText(getByPlaceholderText('Role title'), 'Community coordinator');
    fireEvent.changeText(getByPlaceholderText('Describe the role, expectations, and next steps.'), 'Coordinate local sessions and support volunteers.');
    fireEvent.press(getByText('Paid'));
    const salaryInputs = getAllByPlaceholderText('Optional amount');
    fireEvent.changeText(salaryInputs[0], '55000');
    fireEvent.changeText(salaryInputs[1], '42000');
    fireEvent.press(getByText('Create job'));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith({ title: 'Check job details', description: 'Minimum salary cannot exceed maximum salary.', variant: 'warning' });
    });
    expect(mockCreateJob).not.toHaveBeenCalled();
  });

  it('blocks deadlines in the past', async () => {
    const { getByPlaceholderText, getByText } = render(<NewJobRoute />);

    fireEvent.changeText(getByPlaceholderText('Role title'), 'Community coordinator');
    fireEvent.changeText(getByPlaceholderText('Describe the role, expectations, and next steps.'), 'Coordinate local sessions and support volunteers.');
    fireEvent.changeText(getByPlaceholderText('YYYY-MM-DD'), '2000-01-01');
    fireEvent.press(getByText('Create job'));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith({ title: 'Check job details', description: 'Deadline must be a future date.', variant: 'warning' });
    });
    expect(mockCreateJob).not.toHaveBeenCalled();
  });

  it('submits contact, salary transparency, hiring, and branding fields for paid roles', async () => {
    const { getAllByPlaceholderText, getByPlaceholderText, getByText } = render(<NewJobRoute />);

    fireEvent.changeText(getByPlaceholderText('Role title'), 'Community coordinator');
    fireEvent.changeText(getByPlaceholderText('Describe the role, expectations, and next steps.'), 'Coordinate local sessions and support volunteers.');
    fireEvent.press(getByText('Paid'));
    fireEvent.changeText(getByPlaceholderText('name@example.org'), 'jobs@example.org');
    fireEvent.changeText(getByPlaceholderText('+1 555 123 4567'), '+353 1 234 5678');
    const salaryInputs = getAllByPlaceholderText('Optional amount');
    fireEvent.changeText(salaryInputs[0], '30000');
    fireEvent.changeText(salaryInputs[1], '36000');
    fireEvent.changeText(getByPlaceholderText('EUR'), 'EUR');
    fireEvent.press(getByText('Monthly'));
    fireEvent.press(getByText('Enable blind hiring'));
    fireEvent.changeText(getByPlaceholderText('What makes this team a good place to work?'), 'Community-first team');
    fireEvent.changeText(getByPlaceholderText('https://example.org/video'), 'https://example.org/culture');
    fireEvent.press(getByText('11-50'));
    fireEvent.changeText(getByPlaceholderText('Comma-separated benefits'), 'Mentoring, Flexible hours');
    fireEvent.press(getByText('Create job'));

    await waitFor(() => {
      expect(mockCreateJob).toHaveBeenCalledWith(expect.objectContaining({
        type: 'paid',
        contact_email: 'jobs@example.org',
        contact_phone: '+353 1 234 5678',
        salary_min: 30000,
        salary_max: 36000,
        salary_currency: 'EUR',
        salary_type: 'monthly',
        salary_negotiable: false,
        blind_hiring: true,
        tagline: 'Community-first team',
        video_url: 'https://example.org/culture',
        company_size: '11-50',
        benefits: ['Mentoring', 'Flexible hours'],
      }));
    });
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/(modals)/job-detail', params: { id: '301' } });
  });

  /**
   * 🔴 Worse than a dead form. A failed load in EDIT mode left every field empty under a
   * live "Update job" button, so one tap would have wiped the vacancy's title,
   * description, location and pay. The toast was the only sign, and toasts fade. Same
   * fault as S4-03 on the volunteering form, fixed there and never here.
   */
  it('never shows an empty edit form with a live Update button after a failed load', async () => {
    mockSearchParams = { id: '301' };
    mockGetJobDetail.mockRejectedValue(new ApiResponseError(500, 'Server error'));

    const { findByTestId, queryByText } = render(<NewJobRoute />);

    expect(await findByTestId('new-job-load-failed')).toBeTruthy();
    expect(queryByText('Update job')).toBeNull();
    expect(queryByText('Retry')).toBeTruthy();
  });

  it('offers no retry when the vacancy is simply not this member’s', async () => {
    mockSearchParams = { id: '301' };
    mockGetJobDetail.mockRejectedValue(new ApiResponseError(403, 'Forbidden'));

    const { findByText, queryByText } = render(<NewJobRoute />);

    expect(await findByText('Not available to you')).toBeTruthy();
    expect(queryByText('Retry')).toBeNull();
    expect(queryByText('Update job')).toBeNull();
  });

  it('hydrates an existing job and updates it in edit mode', async () => {
    mockSearchParams = { id: '301' };
    mockGetJobDetail.mockResolvedValueOnce({
      data: {
        id: 301,
        title: 'Existing role',
        description: 'Existing description',
        type: 'timebank',
        commitment: 'part_time',
        location: 'Cork',
        is_remote: false,
        category: 'Community',
        skills_required: 'Planning, Support',
        skills: ['Planning', 'Support'],
        hours_per_week: 8,
        time_credits: 4,
        contact_email: 'old@example.org',
        contact_phone: '+1 555 123 4567',
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_type: null,
        salary_negotiable: false,
        blind_hiring: false,
        tagline: 'Helpful team',
        video_url: '',
        company_size: '51-200',
        benefits: ['Mentoring'],
        deadline: '2099-07-01T00:00:00Z',
        status: 'closed',
      },
    });

    const { getByDisplayValue, getByText } = render(<NewJobRoute />);

    await waitFor(() => expect(getByDisplayValue('Existing role')).toBeTruthy());
    expect(mockDraftGuard.mock.calls.at(-1)?.[0].isDirty).toBe(false);
    expect(getByText('Edit Job')).toBeTruthy();
    expect(getByText('Update the role details.')).toBeTruthy();
    fireEvent.changeText(getByDisplayValue('Existing role'), 'Updated role');
    expect(mockDraftGuard.mock.calls.at(-1)?.[0].isDirty).toBe(true);
    fireEvent.press(getByText('Update job'));

    await waitFor(() => {
      expect(updateJob).toHaveBeenCalledWith(301, expect.objectContaining({
        title: 'Updated role',
        description: 'Existing description',
        type: 'timebank',
        commitment: 'part_time',
        company_size: '51-200',
        skills_required: 'Planning, Support',
      }));
      expect((updateJob as jest.Mock).mock.calls[0]?.[1]).not.toHaveProperty('status');
    });
  });
  it('🔴 no longer multiplies a comma decimal by ten', async () => {
    // An employer offering 1,5 time credits published a vacancy offering 15, and a
    // salary of 50,5 was posted as 505. Half the app’s locales write decimals with a
    // comma and Android’s keypad emits the device locale’s mark.
    const { getAllByPlaceholderText, getByPlaceholderText, getByText } = render(<NewJobRoute />);

    fireEvent.changeText(getByPlaceholderText('Role title'), 'Community coordinator');
    fireEvent.changeText(getByPlaceholderText('Describe the role, expectations, and next steps.'), 'Coordinate local sessions and support volunteers.');
    fireEvent.changeText(getByPlaceholderText('Optional credits'), '1,5');
    fireEvent.changeText(getByPlaceholderText('Optional hours'), '7,5');
    fireEvent.press(getByText('Paid'));
    fireEvent.changeText(getByPlaceholderText('name@example.org'), 'jobs@example.org');
    const salaryInputs = getAllByPlaceholderText('Optional amount');
    fireEvent.changeText(salaryInputs[0], '1.500,50');
    fireEvent.changeText(salaryInputs[1], '2000');
    fireEvent.press(getByText('Create job'));

    await waitFor(() => {
      expect(mockCreateJob).toHaveBeenCalledWith(expect.objectContaining({
        time_credits: 1.5,
        hours_per_week: 7.5,
        salary_min: 1500.5,
        salary_max: 2000,
      }));
    });
  });
});
