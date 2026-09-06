// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The builder is optimistic: it moves a section on screen before the API has agreed, and
 * puts it back if the API refuses. A test that only proved "the API was called" would pass
 * with the rollback deleted, so the reorder case below asserts the ORDER on screen after a
 * refusal — which is the thing a member would otherwise be lied to about.
 */

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockCreateCourseSection = jest.fn();
const mockUpdateCourseSection = jest.fn();
const mockDeleteCourseSection = jest.fn();
const mockCreateCourseLesson = jest.fn();
const mockUpdateCourseLesson = jest.fn();
const mockDeleteCourseLesson = jest.fn();
const mockCreateCourseQuiz = jest.fn();
const mockCreateQuizQuestion = jest.fn();
const mockShowToast = jest.fn();

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
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn((...args: unknown[]) => mockShowToast(...args));
  return { useAppToast: () => ({ show, hide: jest.fn(), isToastVisible: false }) };
});
// The destructive confirmations are inert here; each delete test asserts the API call.
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (options: { onConfirm: () => void }) => options.onConfirm(),
    confirmDialog: null,
  }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/lib/api/courses', () => ({
  createCourseSection: (...args: unknown[]) => mockCreateCourseSection(...args),
  updateCourseSection: (...args: unknown[]) => mockUpdateCourseSection(...args),
  deleteCourseSection: (...args: unknown[]) => mockDeleteCourseSection(...args),
  createCourseLesson: (...args: unknown[]) => mockCreateCourseLesson(...args),
  updateCourseLesson: (...args: unknown[]) => mockUpdateCourseLesson(...args),
  deleteCourseLesson: (...args: unknown[]) => mockDeleteCourseLesson(...args),
  createCourseQuiz: (...args: unknown[]) => mockCreateCourseQuiz(...args),
  createQuizQuestion: (...args: unknown[]) => mockCreateQuizQuestion(...args),
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

import { CourseBuilder } from './CourseBuilder';
import type { CourseSection } from '@/lib/api/courses';

const section = (id: number, title: string, lessons: CourseSection['lessons'] = []): CourseSection => ({
  id, course_id: 42, title, position: 0, lessons,
});

describe('CourseBuilder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShowToast.mockClear();
    mockUpdateCourseSection.mockResolvedValue({ id: 1 });
    mockUpdateCourseLesson.mockResolvedValue({ id: 90 });
  });

  it('adds a section through the API and shows it in the curriculum', async () => {
    mockCreateCourseSection.mockResolvedValue({ id: 5, course_id: 42, title: 'New section', position: 0 });

    const { getByText, getByDisplayValue } = render(<CourseBuilder courseId={42} initialSections={[]} />);

    expect(getByText('No sections yet. Add your first section to start building the curriculum.')).toBeTruthy();
    fireEvent.press(getByText('Add section'));

    await waitFor(() => expect(getByDisplayValue('New section')).toBeTruthy());
    expect(mockCreateCourseSection).toHaveBeenCalledWith(42, { title: 'New section', position: 0 });
  });

  it('renames a section when the field loses focus, and only when it actually changed', async () => {
    const { getByDisplayValue } = render(
      <CourseBuilder courseId={42} initialSections={[section(5, 'Week one')]} />,
    );

    const field = getByDisplayValue('Week one');
    fireEvent(field, 'blur');
    expect(mockUpdateCourseSection).not.toHaveBeenCalled();

    fireEvent.changeText(field, 'Week two');
    fireEvent(field, 'blur');

    await waitFor(() => expect(mockUpdateCourseSection).toHaveBeenCalledWith(42, 5, { title: 'Week two' }));
  });

  it('reorders sections optimistically and puts them back when the API refuses', async () => {
    mockUpdateCourseSection.mockRejectedValue(new Error('nope'));

    const { getAllByLabelText, getAllByDisplayValue } = render(
      <CourseBuilder courseId={42} initialSections={[section(5, 'Week one'), section(6, 'Week two')]} />,
    );

    expect(getAllByDisplayValue(/Week/).map((field) => field.props.value)).toEqual(['Week one', 'Week two']);

    fireEvent.press(getAllByLabelText('Move down')[0]!);

    await waitFor(() => expect(mockUpdateCourseSection).toHaveBeenCalledTimes(2));
    expect(mockUpdateCourseSection).toHaveBeenCalledWith(42, 6, { position: 0 });
    expect(mockUpdateCourseSection).toHaveBeenCalledWith(42, 5, { position: 1 });

    // Rolled back — the member is not shown an order the server rejected.
    await waitFor(() => {
      expect(getAllByDisplayValue(/Week/).map((field) => field.props.value)).toEqual(['Week one', 'Week two']);
    });
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Could not save. Please try again.', variant: 'danger' }),
    );
  });

  it('deletes a lesson after confirmation and drops it from the section', async () => {
    mockDeleteCourseLesson.mockResolvedValue({ deleted: true });

    const { getByLabelText, queryByText } = render(
      <CourseBuilder
        courseId={42}
        initialSections={[section(5, 'Week one', [{
          id: 90, course_id: 42, section_id: 5, title: 'Intro', content_type: 'text', position: 0, is_preview: false,
        }])]}
      />,
    );

    fireEvent.press(getByLabelText('Delete lesson'));

    await waitFor(() => expect(mockDeleteCourseLesson).toHaveBeenCalledWith(42, 90));
    await waitFor(() => expect(queryByText('Intro')).toBeNull());
  });

  it('saves a quiz lesson, creates its quiz, then adds a multiple-choice question', async () => {
    mockCreateCourseLesson.mockResolvedValue({
      id: 90, course_id: 42, section_id: 5, title: 'New lesson', content_type: 'text', position: 0, is_preview: false,
    });
    mockUpdateCourseLesson.mockResolvedValue({
      id: 90, course_id: 42, section_id: 5, title: 'New lesson', content_type: 'quiz', position: 0, is_preview: false,
    });
    mockCreateCourseQuiz.mockResolvedValue({ id: 11, course_id: 42, lesson_id: 90, title: 'New lesson', questions: [] });
    mockCreateQuizQuestion.mockResolvedValue({ id: 501, type: 'mcq', prompt: 'How many hours?' });

    const { getByLabelText, getByText } = render(
      <CourseBuilder courseId={42} initialSections={[section(5, 'Week one')]} />,
    );

    fireEvent.press(getByText('Add lesson'));
    await waitFor(() => expect(getByLabelText('New lesson')).toBeTruthy());

    fireEvent.press(getByLabelText('New lesson'));
    fireEvent.press(getByText('Quiz'));
    fireEvent.press(getByText('Save lesson'));

    await waitFor(() => expect(mockUpdateCourseLesson).toHaveBeenCalledWith(42, 90, expect.objectContaining({
      title: 'New lesson',
      content_type: 'quiz',
      drip_type: 'none',
    })));
    // A quiz lesson is useless without a quiz row, so saving creates one.
    await waitFor(() => expect(mockCreateCourseQuiz).toHaveBeenCalledWith(42, {
      lesson_id: 90, title: 'New lesson', pass_mark_percent: 70, max_attempts: 0,
    }));

    fireEvent.changeText(getByLabelText('Question'), 'How many hours?');
    fireEvent.changeText(getByLabelText('Answer options, separated by commas'), 'One, Two');
    fireEvent.press(getByText('Add question'));

    await waitFor(() => expect(mockCreateQuizQuestion).toHaveBeenCalledWith(42, 11, {
      type: 'mcq',
      prompt: 'How many hours?',
      options: [{ id: 'a', label: 'One' }, { id: 'b', label: 'Two' }],
      correct: ['a'],
      points: 1,
      position: 1,
    }));
    await waitFor(() => expect(getByText('• How many hours?')).toBeTruthy());
  });

  it('shows the drip offset field only for a day-based release, and saves it', async () => {
    const { getByLabelText, getByText, queryByLabelText } = render(
      <CourseBuilder
        courseId={42}
        initialSections={[section(5, 'Week one', [{
          id: 90, course_id: 42, section_id: 5, title: 'Intro', content_type: 'text', position: 0, is_preview: false,
        }])]}
      />,
    );

    fireEvent.press(getByLabelText('Intro'));
    expect(queryByLabelText('Days')).toBeNull();

    fireEvent.press(getByText('Days after enrolment'));
    fireEvent.changeText(getByLabelText('Days'), '7');
    fireEvent.press(getByText('Save lesson'));

    await waitFor(() => expect(mockUpdateCourseLesson).toHaveBeenCalledWith(42, 90, expect.objectContaining({
      drip_type: 'days_after_enroll',
      drip_offset_days: 7,
    })));
  });
});
