// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockCreateJob = jest.fn().mockResolvedValue({ data: { id: 301 } });
const mockGetJobDetail = jest.fn();
const mockGenerateJobDescription = jest.fn();
const mockReplace = jest.fn();
let mockSearchParams: Record<string, string> = {};

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
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#6366f1' }));
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
  return function MockFormActionFooter({ submitLabel, onSubmit }: { submitLabel: string; onSubmit: () => void }) {
    return (
      <View>
        <Pressable accessibilityRole="button" onPress={onSubmit}>
          <Text>{submitLabel}</Text>
        </Pressable>
      </View>
    );
  };
});
jest.mock('heroui-native', () => {
  const React = require('react');
  const { Pressable, Text, TextInput, View } = require('react-native');
  const Button = ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
    <Pressable onPress={onPress}>
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
import { useAppToast } from '@/components/ui/AppToast';

const showToast = useAppToast().show as jest.Mock;

describe('NewJobRoute', () => {
  beforeEach(() => {
    showToast.mockClear();
    mockSearchParams = {};
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

  it('requires a title before generating a role description', async () => {
    const { getByText } = render(<NewJobRoute />);

    fireEvent.press(getByText('Generate with AI'));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith({ title: 'Check job details', description: 'Add a title before generating a description.', variant: 'warning' });
    });
    expect(mockGenerateJobDescription).not.toHaveBeenCalled();
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
    expect(getByText('Edit Job')).toBeTruthy();
    expect(getByText('Update the role details.')).toBeTruthy();
    fireEvent.changeText(getByDisplayValue('Existing role'), 'Updated role');
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
});
