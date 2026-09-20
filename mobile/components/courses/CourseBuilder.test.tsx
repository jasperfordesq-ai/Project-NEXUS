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
import * as ReactNative from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockCreateCourseSection = jest.fn();
const mockUpdateCourseSection = jest.fn();
const mockDeleteCourseSection = jest.fn();
const mockCreateCourseLesson = jest.fn();
const mockUpdateCourseLesson = jest.fn();
const mockDeleteCourseLesson = jest.fn();
const mockCreateCourseQuiz = jest.fn();
const mockCreateQuizQuestion = jest.fn();
const mockShowToast = jest.fn();
let mockHeldConfirm: (() => void) | null = null;
let mockHoldConfirm = false;
const mockReserveCourseAuthoringCreationOperation = jest.fn();
const mockCompleteCourseAuthoringCreationOperation = jest.fn();

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
    confirm: (options: { onConfirm: () => void }) => { if (mockHoldConfirm) mockHeldConfirm = options.onConfirm; else options.onConfirm(); },
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
jest.mock('@/lib/courseAuthoringCreationOperation', () => ({
  reserveCourseAuthoringCreationOperation: (...args: unknown[]) => mockReserveCourseAuthoringCreationOperation(...args),
  completeCourseAuthoringCreationOperation: (...args: unknown[]) => mockCompleteCourseAuthoringCreationOperation(...args),
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
    mockHoldConfirm = false;
    mockHeldConfirm = null;
    mockUpdateCourseSection.mockResolvedValue({ id: 1 });
    mockUpdateCourseLesson.mockResolvedValue({ id: 90 });
    mockReserveCourseAuthoringCreationOperation.mockImplementation(async (resource: string) => ({
      storageKey: `stored-${resource}`, key: `${resource}-key`, createdAt: 1,
    }));
    mockCompleteCourseAuthoringCreationOperation.mockResolvedValue(undefined);
  });

  it.each(['section', 'lesson', 'quiz', 'question'])('does not start %s creation after leaving during operation storage', async (resource) => {
    let resolveOperation!: (value: object) => void;
    mockReserveCourseAuthoringCreationOperation.mockImplementationOnce(() => new Promise(resolve => { resolveOperation = resolve; }));
    const lesson = {
      id: 90, course_id: 42, section_id: 5, title: 'Intro', position: 0, is_preview: false,
      content_type: 'quiz' as const,
      ...(resource === 'question' ? { quiz: { id: 11, course_id: 42, lesson_id: 90, title: 'Quiz', questions: [] } } : {}),
    };
    mockUpdateCourseLesson.mockResolvedValue(lesson);
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Week one', [lesson])]} />);
    if (resource === 'section') fireEvent.press(screen.getByText('Add section'));
    if (resource === 'lesson') fireEvent.press(screen.getByText('Add lesson'));
    if (resource === 'quiz' || resource === 'question') {
      fireEvent.press(screen.getByLabelText('Intro'));
      if (resource === 'quiz') fireEvent.press(screen.getByText('Save lesson'));
      else {
        fireEvent.changeText(screen.getByLabelText('Question'), 'How many?');
        fireEvent.changeText(screen.getByLabelText('Answer options, separated by commas'), 'One, Two');
        fireEvent.press(screen.getByText('Add question'));
      }
    }
    await waitFor(() => expect(mockReserveCourseAuthoringCreationOperation).toHaveBeenCalledTimes(1));
    screen.unmount();
    await act(async () => resolveOperation({ storageKey: 'departed', key: 'old-key', createdAt: 1 }));
    for (const api of [mockCreateCourseSection, mockCreateCourseLesson, mockCreateCourseQuiz, mockCreateQuizQuestion]) expect(api).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it.each(['section', 'lesson'])('ignores a retained delete-%s confirmation after leaving', async (resource) => {
    mockHoldConfirm = true;
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Week one', [{
      id: 90, course_id: 42, section_id: 5, title: 'Intro', content_type: 'text', position: 0, is_preview: false,
    }])]} />);
    fireEvent.press(screen.getByLabelText(resource === 'section' ? 'Delete section' : 'Delete lesson'));
    expect(mockHeldConfirm).not.toBeNull();
    screen.unmount();
    await act(async () => mockHeldConfirm!());
    expect(mockDeleteCourseSection).not.toHaveBeenCalled();
    expect(mockDeleteCourseLesson).not.toHaveBeenCalled();
  });

  it('does not begin quiz provisioning after leaving during a lesson save', async () => {
    let resolveSave!: (value: object) => void;
    mockUpdateCourseLesson.mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }));
    const lesson = { id: 90, course_id: 42, section_id: 5, title: 'Intro', content_type: 'quiz' as const, position: 0, is_preview: false };
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Week one', [lesson])]} />);
    fireEvent.press(screen.getByLabelText('Intro'));
    fireEvent.press(screen.getByText('Save lesson'));
    screen.unmount();
    await act(async () => resolveSave(lesson));
    expect(mockReserveCourseAuthoringCreationOperation).not.toHaveBeenCalled();
    expect(mockCreateCourseQuiz).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('shows only the replacement course curriculum when the course changes', async () => {
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Old course section')]} />);
    screen.rerender(<CourseBuilder courseId={43} initialSections={[{ ...section(6, 'Current section'), course_id: 43 }]} />);
    expect(screen.queryByDisplayValue('Old course section')).toBeNull();
    expect(screen.getByDisplayValue('Current section')).toBeTruthy();
  });

  it.each([true, false])('contains a section response after departure (accepted=%s)', async (accepted) => {
    let resolveCreate!: (value: object) => void;
    let rejectCreate!: (reason: Error) => void;
    mockCreateCourseSection.mockImplementationOnce(() => new Promise((resolve, reject) => { resolveCreate = resolve; rejectCreate = reject; }));
    const screen = render(<CourseBuilder courseId={42} initialSections={[]} />);
    fireEvent.press(screen.getByText('Add section'));
    await waitFor(() => expect(mockCreateCourseSection).toHaveBeenCalledTimes(1));
    screen.unmount();
    await act(async () => { if (accepted) resolveCreate(section(5, 'Saved')); else rejectCreate(new Error('Offline')); });
    expect(mockCompleteCourseAuthoringCreationOperation).toHaveBeenCalledTimes(accepted ? 1 : 0);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('moves lesson controls below an unclamped lesson title at large text', () => {
    const dimensions = jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({ width: 360, height: 800, scale: 1, fontScale: 2 });
    const lesson = {
      id: 90, course_id: 42, section_id: 5, title: 'A deliberately long lesson title that must remain readable',
      content_type: 'text' as const, body: 'Lesson body', position: 0, is_preview: false,
    };
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Week one', [lesson])]} />);

    expect(screen.getByTestId('course-lesson-90-header').props.className).not.toContain('flex-row');
    expect(screen.getByText(lesson.title).props.numberOfLines).toBeUndefined();
    screen.unmount();
    dimensions.mockRestore();
  });

  it('adds a section through the API and shows it in the curriculum', async () => {
    mockCreateCourseSection.mockResolvedValue({ id: 5, course_id: 42, title: 'New section', position: 0 });

    const { getByText, getByDisplayValue } = render(<CourseBuilder courseId={42} initialSections={[]} />);

    expect(getByText('No sections yet. Add your first section to start building the curriculum.')).toBeTruthy();
    fireEvent.press(getByText('Add section'));

    await waitFor(() => expect(getByDisplayValue('New section')).toBeTruthy());
    expect(mockCreateCourseSection).toHaveBeenCalledWith(42, { title: 'New section', position: 0 }, 'section-key');
    expect(mockCompleteCourseAuthoringCreationOperation).toHaveBeenCalledWith(expect.objectContaining({ key: 'section-key' }));
  });

  it('creates one section when Add section is pressed repeatedly before it resolves', async () => {
    let release: (value: unknown) => void = () => {};
    mockCreateCourseSection.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const { getByText } = render(<CourseBuilder courseId={42} initialSections={[]} />);

    fireEvent.press(getByText('Add section'));
    await waitFor(() => expect(mockCreateCourseSection).toHaveBeenCalledTimes(1));
    fireEvent.press(getByText('Add section'));
    fireEvent.press(getByText('Add section'));

    expect(mockCreateCourseSection).toHaveBeenCalledTimes(1);
    await act(async () => { release({ id: 5, course_id: 42, title: 'New section', position: 0 }); });
  });

  it('retries a lost section response with the same durable key', async () => {
    mockCreateCourseSection
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ id: 5, course_id: 42, title: 'New section', position: 0 });
    const { getByText, getByDisplayValue } = render(<CourseBuilder courseId={42} initialSections={[]} />);

    fireEvent.press(getByText('Add section'));
    await waitFor(() => expect(mockCreateCourseSection).toHaveBeenCalledTimes(1));
    expect(mockCompleteCourseAuthoringCreationOperation).not.toHaveBeenCalled();

    fireEvent.press(getByText('Add section'));
    await waitFor(() => expect(getByDisplayValue('New section')).toBeTruthy());
    expect(mockCreateCourseSection).toHaveBeenNthCalledWith(
      1, 42, { title: 'New section', position: 0 }, 'section-key',
    );
    expect(mockCreateCourseSection).toHaveBeenNthCalledWith(
      2, 42, { title: 'New section', position: 0 }, 'section-key',
    );
    expect(mockCompleteCourseAuthoringCreationOperation).toHaveBeenCalledTimes(1);
  });

  it('creates one lesson per section when Add lesson is pressed repeatedly before it resolves', async () => {
    let release: (value: unknown) => void = () => {};
    mockCreateCourseLesson.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const { getByText } = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Week one')]} />);

    fireEvent.press(getByText('Add lesson'));
    await waitFor(() => expect(mockCreateCourseLesson).toHaveBeenCalledTimes(1));
    fireEvent.press(getByText('Add lesson'));
    fireEvent.press(getByText('Add lesson'));

    expect(mockCreateCourseLesson).toHaveBeenCalledTimes(1);
    await act(async () => { release({
      id: 90, course_id: 42, section_id: 5, title: 'New lesson', content_type: 'text', position: 0, is_preview: false,
    }); });
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

  it('retains a newly saved lesson when an older section rename fails', async () => {
    let rejectRename!: (reason: Error) => void;
    mockUpdateCourseSection.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRename = reject; }));
    mockCreateCourseLesson.mockResolvedValue({ id: 90, course_id: 42, section_id: 5, title: 'Saved lesson', content_type: 'text', position: 0, is_preview: false });
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Week one')]} />);
    const field = screen.getByDisplayValue('Week one');
    fireEvent.changeText(field, 'Revised week');
    fireEvent(field, 'blur');
    await waitFor(() => expect(mockUpdateCourseSection).toHaveBeenCalledTimes(1));
    fireEvent.press(screen.getByText('Add lesson'));
    await waitFor(() => expect(screen.getByText('Saved lesson')).toBeTruthy());
    await act(async () => rejectRename(new Error('Refused')));
    expect(screen.getByText('Saved lesson')).toBeTruthy();
    expect(screen.getByDisplayValue('Revised week')).toBeTruthy();
    fireEvent(screen.getByDisplayValue('Revised week'), 'blur');
    await waitFor(() => expect(mockUpdateCourseSection).toHaveBeenCalledTimes(2));
  });

  it('sends consecutive section renames in order instead of racing the saved title', async () => {
    let resolveRename!: (value: object) => void;
    mockUpdateCourseSection.mockImplementationOnce(() => new Promise(resolve => { resolveRename = resolve; }));
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Week one')]} />);
    const field = screen.getByDisplayValue('Week one');
    fireEvent.changeText(field, 'First edit');
    fireEvent(field, 'blur');
    await waitFor(() => expect(mockUpdateCourseSection).toHaveBeenCalledTimes(1));
    fireEvent.changeText(field, 'Second edit');
    fireEvent(field, 'blur');
    await act(async () => {});
    expect(mockUpdateCourseSection).toHaveBeenCalledTimes(1);
    await act(async () => resolveRename({ id: 5, title: 'First edit' }));
    await waitFor(() => expect(mockUpdateCourseSection).toHaveBeenCalledTimes(2));
    expect(mockUpdateCourseSection).toHaveBeenLastCalledWith(42, 5, { title: 'Second edit' });
    expect(screen.getByDisplayValue('Second edit')).toBeTruthy();
    fireEvent(screen.getByDisplayValue('Second edit'), 'blur');
    await act(async () => {});
    expect(mockUpdateCourseSection).toHaveBeenCalledTimes(2);
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
    }, 'quiz-key'));

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
    }, 'question-key'));
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
