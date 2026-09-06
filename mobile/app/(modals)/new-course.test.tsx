// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Covers BOTH modes of the route — create (`/(modals)/new-course`) and edit
 * (`?id=`) — because they are one file and the edit path is where a member's existing
 * course can be damaged.
 */

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockCreateCourse = jest.fn();
const mockUpdateCourse = jest.fn();
const mockGetCourse = jest.fn();
const mockGetCourseCategories = jest.fn();
const mockGetCourseCohorts = jest.fn();
const mockCreateCourseCohort = jest.fn();
const mockPublishCourse = jest.fn();
const mockUnpublishCourse = jest.fn();
const mockShowToast = jest.fn();
const mockPush = jest.fn();
let mockSearchParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: (...args: unknown[]) => mockPush(...args), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockSearchParams,
}));

// The unsaved-changes guard is inert here; it has its own coverage in the hook's tests.
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (options: { onConfirm: () => void }) => options.onConfirm(),
    confirmDialog: null,
  }),
}));

// Resolve against the SHIPPED English copy, so a renamed or missing key fails the test.
jest.mock('react-i18next', () => {
  const courses = require('../../locales/en/courses.json');
  const common = require('../../locales/en/common.json');
  const dig = (source: Record<string, unknown>, key: string): unknown =>
    key.split('.').reduce<unknown>(
      (value, part) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined),
      source,
    );
  return {
    useTranslation: () => ({
      t: (key: string) => {
        const isCommon = key.startsWith('common:');
        const resolved = dig(isCommon ? common : courses, isCommon ? key.slice('common:'.length) : key);
        return typeof resolved === 'string' ? resolved : key;
      },
      i18n: { language: 'en' },
    }),
  };
});

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff', surface: '#f8fafc', text: '#000000', textSecondary: '#666666',
    textMuted: '#999999', border: '#dddddd', error: '#dc2626',
  }),
}));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn((...args: unknown[]) => mockShowToast(...args));
  return { useAppToast: () => ({ show, hide: jest.fn(), isToastVisible: false }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/lib/api/courses', () => ({
  createCourse: (...args: unknown[]) => mockCreateCourse(...args),
  updateCourse: (...args: unknown[]) => mockUpdateCourse(...args),
  getCourse: (...args: unknown[]) => mockGetCourse(...args),
  getCourseCategories: (...args: unknown[]) => mockGetCourseCategories(...args),
  getCourseCohorts: (...args: unknown[]) => mockGetCourseCohorts(...args),
  createCourseCohort: (...args: unknown[]) => mockCreateCourseCohort(...args),
  publishCourse: (...args: unknown[]) => mockPublishCourse(...args),
  unpublishCourse: (...args: unknown[]) => mockUnpublishCourse(...args),
  // Used by the embedded CourseBuilder; unreachable in these cases but must exist.
  createCourseSection: jest.fn(),
  updateCourseSection: jest.fn(),
  deleteCourseSection: jest.fn(),
  createCourseLesson: jest.fn(),
  updateCourseLesson: jest.fn(),
  deleteCourseLesson: jest.fn(),
  createCourseQuiz: jest.fn(),
  createQuizQuestion: jest.fn(),
}));
jest.mock('heroui-native', () => {
  const ReactLib = require('react');
  const { Pressable, Text, TextInput, View } = require('react-native');

  const Button = ({ children, onPress, isDisabled }: { children: React.ReactNode; onPress?: () => void; isDisabled?: boolean }) => (
    <Pressable onPress={isDisabled ? undefined : onPress}><View>{children}</View></Pressable>
  );
  Button.Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;

  const Card = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Card.Body = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;

  const Chip = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Chip.Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;

  const TagGroupContext = ReactLib.createContext(null);
  const TagGroup = ({ children, onSelectionChange }: {
    children: React.ReactNode;
    onSelectionChange?: (keys: Set<string | number>) => void;
  }) => (
    <TagGroupContext.Provider value={{ onSelectionChange }}>
      <View>{children}</View>
    </TagGroupContext.Provider>
  );
  TagGroup.List = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  TagGroup.Item = ({ children, id }: { children: React.ReactNode; id: string | number }) => {
    const ctx = ReactLib.useContext(TagGroupContext) as { onSelectionChange?: (keys: Set<string | number>) => void } | null;
    return <Pressable onPress={() => ctx?.onSelectionChange?.(new Set([id]))}><View>{children}</View></Pressable>;
  };
  TagGroup.ItemLabel = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;

  return {
    Button,
    Card,
    Chip,
    Text,
    TagGroup,
    Spinner: () => null,
    TextField: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    Label: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    Input: ReactLib.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => <TextInput ref={ref} {...props} />),
    TextArea: ReactLib.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => <TextInput ref={ref} {...props} />),
    FieldError: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    Checkbox: ({ isSelected, onSelectedChange, accessibilityLabel }: {
      isSelected?: boolean;
      onSelectedChange?: (next: boolean) => void;
      accessibilityLabel?: string;
    }) => (
      <Pressable accessibilityLabel={accessibilityLabel} onPress={() => onSelectedChange?.(!isSelected)}>
        <View />
      </Pressable>
    ),
  };
});

import NewCourseRoute from './new-course';

const existingCourse = {
  id: 42,
  title: 'Repair skills',
  slug: 'repair-skills',
  summary: 'Fix things together',
  description: 'A longer description.',
  level: 'intermediate',
  visibility: 'public',
  enrollment_type: 'cohort',
  category_id: 3,
  credit_cost: '2.00',
  prerequisites: [7, 9],
  enrollment_count: 5,
  completion_count: 2,
  status: 'draft',
  moderation_status: 'pending',
  sections: [],
};

describe('NewCourseRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShowToast.mockClear();
    mockSearchParams = {};
    mockGetCourseCategories.mockResolvedValue([{ id: 3, name: 'Wellbeing', slug: 'wellbeing' }]);
    mockGetCourseCohorts.mockResolvedValue([]);
    mockGetCourse.mockResolvedValue(existingCourse);
    mockCreateCourse.mockResolvedValue({ ...existingCourse, id: 99, title: 'Repair skills', sections: [] });
    mockUpdateCourse.mockResolvedValue({ ...existingCourse });
  });

  it('refuses to save a course with no title', async () => {
    const { getByText } = render(<NewCourseRoute />);

    await waitFor(() => expect(mockGetCourseCategories).toHaveBeenCalled());
    fireEvent.press(getByText('Save'));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'This field is required.', variant: 'warning' }),
    ));
    expect(mockCreateCourse).not.toHaveBeenCalled();
  });

  it('creates a course with the details entered, then unlocks the curriculum builder', async () => {
    const { getByLabelText, getByText, queryByText } = render(<NewCourseRoute />);

    await waitFor(() => expect(mockGetCourseCategories).toHaveBeenCalled());
    // Before a course exists there is nothing to build a curriculum on.
    expect(queryByText('Course builder')).toBeNull();

    fireEvent.changeText(getByLabelText('Title'), '  Repair skills  ');
    fireEvent.changeText(getByLabelText('Short summary'), 'Fix things together');
    fireEvent.changeText(getByLabelText('Description'), 'A longer description.');
    fireEvent.press(getByText('Advanced'));
    fireEvent.press(getByText('Public'));
    fireEvent.press(getByText('Wellbeing'));
    fireEvent.changeText(getByLabelText('Time-credit cost'), '2');
    // Deliberately messy: blanks and a zero must be dropped, not sent as course ids.
    fireEvent.changeText(getByLabelText('Prerequisite course IDs'), '7, , 9, 0, x');
    fireEvent.press(getByText('Save'));

    await waitFor(() => expect(mockCreateCourse).toHaveBeenCalledWith({
      title: 'Repair skills',
      summary: 'Fix things together',
      description: 'A longer description.',
      level: 'advanced',
      visibility: 'public',
      enrollment_type: 'self_paced',
      category_id: 3,
      credit_cost: 2,
      prerequisites: [7, 9],
    }));
    await waitFor(() => expect(getByText('Course builder')).toBeTruthy());
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Saved', variant: 'success' }));
  });

  it('reads a comma decimal separator as a decimal, not as thousands', async () => {
    const { getByLabelText, getByText } = render(<NewCourseRoute />);

    await waitFor(() => expect(mockGetCourseCategories).toHaveBeenCalled());
    fireEvent.changeText(getByLabelText('Title'), 'Repair skills');
    fireEvent.changeText(getByLabelText('Time-credit cost'), '1,5');
    fireEvent.press(getByText('Save'));

    await waitFor(() => expect(mockCreateCourse).toHaveBeenCalledWith(
      expect.objectContaining({ credit_cost: 1.5 }),
    ));
  });

  it('hydrates an existing course in edit mode and updates it', async () => {
    mockSearchParams = { id: '42' };

    const { getByDisplayValue, getByLabelText, getByText } = render(<NewCourseRoute />);

    await waitFor(() => expect(getByDisplayValue('Repair skills')).toBeTruthy());
    expect(mockGetCourse).toHaveBeenCalledWith(42);
    expect(getByDisplayValue('7, 9')).toBeTruthy();
    expect(getByDisplayValue('2.00')).toBeTruthy();
    // The builder and the cohort list only exist once the course does.
    expect(getByText('Course builder')).toBeTruthy();
    expect(getByText('Cohorts')).toBeTruthy();

    fireEvent.changeText(getByLabelText('Title'), 'Repair skills II');
    fireEvent.press(getByText('Save'));

    await waitFor(() => expect(mockUpdateCourse).toHaveBeenCalledWith(42, expect.objectContaining({
      title: 'Repair skills II',
      level: 'intermediate',
      visibility: 'public',
      enrollment_type: 'cohort',
      category_id: 3,
      credit_cost: 2,
      prerequisites: [7, 9],
    })));
    expect(mockCreateCourse).not.toHaveBeenCalled();
  });

  it('publishes from edit mode and shows the resulting state', async () => {
    mockSearchParams = { id: '42' };
    mockPublishCourse.mockResolvedValue({ ...existingCourse, status: 'published', moderation_status: 'approved' });

    const { getByDisplayValue, getByText, queryByText } = render(<NewCourseRoute />);

    await waitFor(() => expect(getByDisplayValue('Repair skills')).toBeTruthy());
    expect(getByText('Draft')).toBeTruthy();

    fireEvent.press(getByText('Publish'));

    await waitFor(() => expect(mockPublishCourse).toHaveBeenCalledWith(42));
    await waitFor(() => expect(getByText('Published')).toBeTruthy());
    expect(queryByText('Draft')).toBeNull();
    expect(getByText('Unpublish')).toBeTruthy();
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Course published — it is now visible to members.',
      variant: 'success',
    }));
  });

  it('says a course is awaiting review rather than claiming it is live', async () => {
    mockSearchParams = { id: '42' };
    mockPublishCourse.mockResolvedValue({ ...existingCourse, status: 'published', moderation_status: 'pending' });

    const { getByDisplayValue, getByText } = render(<NewCourseRoute />);
    await waitFor(() => expect(getByDisplayValue('Repair skills')).toBeTruthy());

    fireEvent.press(getByText('Publish'));

    await waitFor(() => expect(getByText('Pending review')).toBeTruthy());
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Pending review',
      variant: 'success',
    }));
  });

  it('adds a cohort to a cohort-paced course and reloads the list', async () => {
    mockSearchParams = { id: '42' };
    mockCreateCourseCohort.mockResolvedValue({ id: 8, course_id: 42, name: 'Autumn' });
    mockGetCourseCohorts
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 8, course_id: 42, name: 'Autumn' }]);

    const { getByDisplayValue, getByLabelText, getByText } = render(<NewCourseRoute />);
    await waitFor(() => expect(getByDisplayValue('Repair skills')).toBeTruthy());
    expect(getByText('No cohorts yet.')).toBeTruthy();

    fireEvent.changeText(getByLabelText('Cohort name'), '  Autumn  ');
    fireEvent.press(getByText('Add cohort'));

    await waitFor(() => expect(mockCreateCourseCohort).toHaveBeenCalledWith(42, { name: 'Autumn' }));
    await waitFor(() => expect(getByText('• Autumn')).toBeTruthy());
  });

  it('hides the cohort list for a self-paced course', async () => {
    mockSearchParams = { id: '42' };
    mockGetCourse.mockResolvedValue({ ...existingCourse, enrollment_type: 'self_paced' });

    const { getByDisplayValue, getByText, queryByText } = render(<NewCourseRoute />);

    await waitFor(() => expect(getByDisplayValue('Repair skills')).toBeTruthy());
    expect(getByText('Course builder')).toBeTruthy();
    expect(queryByText('Cohorts')).toBeNull();
  });
});
