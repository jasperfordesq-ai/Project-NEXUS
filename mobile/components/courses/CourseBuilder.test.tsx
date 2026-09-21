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
const mockReorderSections = jest.fn();
const mockReorderLessons = jest.fn();
const mockGetCourse = jest.fn();
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
  reorderCourseSections: (...args: unknown[]) => mockReorderSections(...args),
  reorderCourseLessons: (...args: unknown[]) => mockReorderLessons(...args),
  getCourse: (...args: unknown[]) => mockGetCourse(...args),
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
    Input: ReactLib.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => <TextInput ref={ref} {...props} editable={!props.isDisabled} />),
    TextArea: ReactLib.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => <TextInput ref={ref} {...props} editable={!props.isDisabled} />),
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
    mockReorderSections.mockReset();
    mockReorderLessons.mockReset();
    mockGetCourse.mockReset();
    mockHoldConfirm = false;
    mockHeldConfirm = null;
    mockUpdateCourseSection.mockResolvedValue({ id: 1 });
    mockUpdateCourseLesson.mockResolvedValue({ id: 90 });
    mockReserveCourseAuthoringCreationOperation.mockImplementation(async (resource: string) => ({
      storageKey: `stored-${resource}`, key: `${resource}-key`, createdAt: 1,
    }));
    mockCompleteCourseAuthoringCreationOperation.mockResolvedValue(undefined);
  });

  it.each([false, true])('retains an accepted lesson whose section was deleted before its response arrived (same batch=%s)', async sameBatch => {
    let accept!: (value: object) => void;
    let remove!: () => void;
    mockCreateCourseLesson.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
    mockDeleteCourseSection.mockImplementationOnce(() => new Promise<void>(resolve => { remove = resolve; }));
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Original')]} />);
    fireEvent.press(screen.getByText('Add lesson'));
    await waitFor(() => expect(mockCreateCourseLesson).toHaveBeenCalledTimes(1));
    fireEvent.press(screen.getByLabelText('Delete section'));
    if (!sameBatch) {
      await act(async () => remove());
      await waitFor(() => expect(screen.queryByDisplayValue('Original')).toBeNull());
    }
    await act(async () => {
      if (sameBatch) remove();
      accept({ id: 90, course_id: 42, section_id: 5, title: 'Accepted late', content_type: 'text', position: 0, is_preview: false });
    });
    expect(screen.getByText('Accepted late')).toBeTruthy();
    expect(screen.getByText('Lessons without a section')).toBeTruthy();
    expect(mockCompleteCourseAuthoringCreationOperation).toHaveBeenCalled();
  });

  it('does not create a lesson after its section disappears during operation storage', async () => {
    let reserve!: (value: object) => void;
    let remove!: () => void;
    mockReserveCourseAuthoringCreationOperation.mockImplementationOnce(() => new Promise(resolve => { reserve = resolve; }));
    mockDeleteCourseSection.mockImplementationOnce(() => new Promise<void>(resolve => { remove = resolve; }));
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Original')]} />);
    fireEvent.press(screen.getByText('Add lesson'));
    expect(mockReserveCourseAuthoringCreationOperation).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByLabelText('Delete section'));
    expect(mockDeleteCourseSection).toHaveBeenCalledWith(42, 5);
    expect(screen.getByDisplayValue('Original')).toBeTruthy();
    await act(async () => remove());
    expect(screen.queryByDisplayValue('Original')).toBeNull();
    await act(async () => reserve({ key: 'held', storageKey: 'held', createdAt: 1 }));
    expect(mockCreateCourseLesson).not.toHaveBeenCalled();
  });

  it('does not apply an old lesson deletion confirmation after its section has been removed', async () => {
    const lesson = { id: 90, course_id: 42, section_id: 5, title: 'Preserved', content_type: 'text' as const, position: 0, is_preview: false };
    mockHoldConfirm = true;
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Original', [lesson])]} />);
    fireEvent.press(screen.getByLabelText('Delete lesson'));
    const oldConfirmation = mockHeldConfirm!;
    mockHoldConfirm = false;
    let remove!: () => void;
    mockDeleteCourseSection.mockImplementationOnce(() => new Promise<void>(resolve => { remove = resolve; }));
    fireEvent.press(screen.getByLabelText('Delete section'));
    expect(mockDeleteCourseSection).toHaveBeenCalledWith(42, 5);
    expect(screen.getByDisplayValue('Original')).toBeTruthy();
    await act(async () => remove());
    expect(screen.queryByDisplayValue('Original')).toBeNull();
    await act(async () => oldConfirmation());
    expect(mockDeleteCourseLesson).not.toHaveBeenCalled();
    expect(screen.getByText('Preserved')).toBeTruthy();
  });

  it('keeps unsaved lesson edits when deleting their section is requested', async () => {
    const lesson = { id: 90, course_id: 42, section_id: 5, title: 'Original', content_type: 'text' as const, position: 0, is_preview: false };
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Section', [lesson])]} />);
    fireEvent.press(screen.getByLabelText('Original'));
    fireEvent.changeText(screen.getByLabelText('Lesson title'), 'Unsaved work');
    await act(async () => fireEvent.press(screen.getByLabelText('Delete section')));
    expect(mockDeleteCourseSection).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Lesson title').props.value).toBe('Unsaved work');
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' }));
  });

  it('rechecks lesson drafts when an earlier section deletion confirmation is accepted', async () => {
    const lesson = { id: 90, course_id: 42, section_id: 5, title: 'Original', content_type: 'text' as const, position: 0, is_preview: false };
    mockHoldConfirm = true;
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Section', [lesson])]} />);
    fireEvent.press(screen.getByLabelText('Delete section'));
    const accept = mockHeldConfirm!;
    fireEvent.press(screen.getByLabelText('Original'));
    fireEvent.changeText(screen.getByLabelText('Lesson title'), 'Unsaved work');
    await act(async () => accept());
    expect(mockDeleteCourseSection).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Lesson title').props.value).toBe('Unsaved work');
  });

  it('waits for a lesson save before allowing section deletion', async () => {
    const lesson = { id: 90, course_id: 42, section_id: 5, title: 'Original', content_type: 'text' as const, position: 0, is_preview: false };
    let accept!: (value: object) => void;
    mockUpdateCourseLesson.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
    mockDeleteCourseSection.mockResolvedValue(undefined);
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Section', [lesson])]} />);
    fireEvent.press(screen.getByLabelText('Original'));
    fireEvent.press(screen.getByText('Save lesson'));
    await act(async () => fireEvent.press(screen.getByLabelText('Delete section')));
    expect(mockDeleteCourseSection).not.toHaveBeenCalled();
    await act(async () => accept(lesson));
    await act(async () => fireEvent.press(screen.getByLabelText('Delete section')));
    expect(mockDeleteCourseSection).toHaveBeenCalledWith(42, 5);
    expect(screen.getByText('Lessons without a section')).toBeTruthy();
  });

  it('protects unfinished questions without preventing deletion of another section', async () => {
    const lesson = { id: 90, course_id: 42, section_id: 5, title: 'Quiz', content_type: 'quiz' as const, position: 0, is_preview: false, quiz: { id: 11, course_id: 42, lesson_id: 90, title: 'Quiz', questions: [] } };
    mockDeleteCourseSection.mockResolvedValue(undefined);
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Keep', [lesson]), section(6, 'Remove')]} />);
    fireEvent.press(screen.getByLabelText('Quiz'));
    fireEvent.changeText(screen.getByLabelText('Question'), 'Unfinished question');
    await act(async () => fireEvent.press(screen.getAllByLabelText('Delete section')[0]!));
    expect(mockDeleteCourseSection).not.toHaveBeenCalled();
    await act(async () => fireEvent.press(screen.getAllByLabelText('Delete section')[1]!));
    expect(mockDeleteCourseSection).toHaveBeenCalledWith(42, 6);
    expect(screen.getByLabelText('Question').props.value).toBe('Unfinished question');
  });

  it('protects an unsaved section title until its original value is restored', async () => {
    mockDeleteCourseSection.mockResolvedValue(undefined);
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Original')]} />);
    fireEvent.changeText(screen.getByLabelText('Section title'), 'Unsaved section');
    await act(async () => fireEvent.press(screen.getByLabelText('Delete section')));
    expect(mockDeleteCourseSection).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByLabelText('Section title'), 'Original');
    await act(async () => fireEvent.press(screen.getByLabelText('Delete section')));
    expect(mockDeleteCourseSection).toHaveBeenCalledWith(42, 5);
  });

  it.each([false, true])('locks section editing during deletion and restores it on failure (quiz=%s)', async quiz => {
    const lesson = { id: 90, course_id: 42, section_id: 5, title: 'Original', content_type: quiz ? 'quiz' as const : 'text' as const, position: 0, is_preview: false,
      quiz: quiz ? { id: 11, course_id: 42, lesson_id: 90, title: 'Quiz', questions: [] } : undefined };
    let reject!: (error: Error) => void;
    mockDeleteCourseSection.mockImplementationOnce(() => new Promise((_, rejectPromise) => { reject = rejectPromise; }));
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Section', [lesson]), section(6, 'Other')]} />);
    fireEvent.press(screen.getByLabelText('Original'));
    fireEvent.press(screen.getAllByLabelText('Delete section')[0]!);
    expect(screen.getByLabelText('Lesson title').props.editable).toBe(false);
    expect(screen.getAllByLabelText('Section title')[0]!.props.editable).toBe(false);
    expect(screen.getAllByLabelText('Section title')[1]!.props.editable).not.toBe(false);
    if (quiz) expect(screen.getByLabelText('Question').props.editable).toBe(false);
    expect(screen.getByText('Deleting section…')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Lesson title'), 'Too late');
    expect(screen.getByLabelText('Lesson title').props.value).toBe('Original');
    fireEvent.press(screen.getByText('Save lesson'));
    expect(mockUpdateCourseLesson).not.toHaveBeenCalled();
    await act(async () => reject(new Error('Offline')));
    expect(screen.queryByText('Deleting section…')).toBeNull();
    expect(screen.getByLabelText('Lesson title').props.editable).not.toBe(false);
    fireEvent.changeText(screen.getByLabelText('Lesson title'), 'Recovered draft');
    expect(screen.getByLabelText('Lesson title').props.value).toBe('Recovered draft');
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));
  });

  it('preserves newer lesson text when an earlier save finishes', async () => {
    const lesson = { id: 90, course_id: 42, section_id: 5, title: 'Original', content_type: 'text' as const, position: 0, is_preview: false };
    const changed = jest.fn();
    let accept!: (value: object) => void;
    mockUpdateCourseLesson.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Section', [lesson])]} onPendingChangesChange={changed} />);
    fireEvent.press(screen.getByLabelText('Original'));
    fireEvent.changeText(screen.getByLabelText('Lesson title'), 'Submitted title');
    fireEvent.press(screen.getByText('Save lesson'));
    fireEvent.changeText(screen.getByLabelText('Lesson title'), 'Newer unsaved title');
    await act(async () => accept({ ...lesson, title: 'Submitted title' }));
    expect(screen.getByLabelText('Lesson title').props.value).toBe('Newer unsaved title');
    expect(changed).toHaveBeenLastCalledWith({ isDirty: true, isSaving: false });
  });

  it('preserves a newer question draft and lesson title when question creation finishes', async () => {
    const lesson = { id: 90, course_id: 42, section_id: 5, title: 'Quiz', content_type: 'quiz' as const, position: 0, is_preview: false, quiz: { id: 11, course_id: 42, lesson_id: 90, title: 'Quiz', questions: [] } };
    const changed = jest.fn();
    let accept!: (value: object) => void;
    mockCreateQuizQuestion.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Section', [lesson])]} onPendingChangesChange={changed} />);
    fireEvent.press(screen.getByLabelText('Quiz'));
    fireEvent.changeText(screen.getByLabelText('Question'), 'Submitted question');
    fireEvent.press(screen.getByText('Add question'));
    await waitFor(() => expect(mockCreateQuizQuestion).toHaveBeenCalled());
    fireEvent.press(screen.getByText('Save lesson'));
    expect(mockUpdateCourseLesson).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByLabelText('Question'), 'Next question');
    fireEvent.changeText(screen.getByLabelText('Lesson title'), 'Newer quiz title');
    await act(async () => accept({ id: 501, prompt: 'Submitted question' }));
    expect(screen.getByLabelText('Question').props.value).toBe('Next question');
    expect(screen.getByLabelText('Lesson title').props.value).toBe('Newer quiz title');
    expect(changed).toHaveBeenLastCalledWith({ isDirty: true, isSaving: false });
  });

  it('reports dirty, saving, failed and confirmed lesson state to the route guard', async () => {
    const lesson = { id: 90, course_id: 42, section_id: 5, title: 'Original', content_type: 'text' as const, position: 0, is_preview: false };
    const changed = jest.fn();
    let rejectSave!: (error: Error) => void;
    mockUpdateCourseLesson.mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; }))
      .mockResolvedValueOnce({ ...lesson, title: 'Changed' });
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Section', [lesson])]} onPendingChangesChange={changed} />);
    expect(changed).toHaveBeenLastCalledWith({ isDirty: false, isSaving: false });
    fireEvent.press(screen.getByLabelText('Original'));
    fireEvent.changeText(screen.getByLabelText('Lesson title'), 'Changed');
    expect(changed).toHaveBeenLastCalledWith({ isDirty: true, isSaving: false });
    fireEvent.press(screen.getByText('Save lesson'));
    expect(changed).toHaveBeenLastCalledWith({ isDirty: true, isSaving: true });
    await act(async () => rejectSave(new Error('Offline')));
    expect(changed).toHaveBeenLastCalledWith({ isDirty: true, isSaving: false });
    fireEvent.press(screen.getByText('Save lesson'));
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith({ isDirty: false, isSaving: false }));
  });

  it('reports an unfinished quiz question even if the lesson itself is unchanged', () => {
    const lesson = { id: 90, course_id: 42, section_id: 5, title: 'Quiz', content_type: 'quiz' as const, position: 0, is_preview: false, quiz: { id: 11, course_id: 42, lesson_id: 90, title: 'Quiz', questions: [] } };
    const changed = jest.fn();
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Section', [lesson])]} onPendingChangesChange={changed} />);
    fireEvent.press(screen.getByLabelText('Quiz'));
    fireEvent.changeText(screen.getByLabelText('Question'), 'Unfinished question');
    expect(changed).toHaveBeenLastCalledWith({ isDirty: true, isSaving: false });
  });

  it('does not consider an unsaved lesson title saved when a quiz question is added', async () => {
    const lesson = { id: 90, course_id: 42, section_id: 5, title: 'Quiz', content_type: 'quiz' as const, position: 0, is_preview: false, quiz: { id: 11, course_id: 42, lesson_id: 90, title: 'Quiz', questions: [] } };
    const changed = jest.fn();
    mockCreateQuizQuestion.mockResolvedValue({ id: 501, prompt: 'Question' });
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Section', [lesson])]} onPendingChangesChange={changed} />);
    fireEvent.press(screen.getByLabelText('Quiz'));
    fireEvent.changeText(screen.getByLabelText('Lesson title'), 'Unsent title');
    fireEvent.changeText(screen.getByLabelText('Question'), 'Question');
    fireEvent.press(screen.getByText('Add question'));
    await waitFor(() => expect(screen.getByLabelText('Question').props.value).toBe(''));
    expect(changed).toHaveBeenLastCalledWith({ isDirty: true, isSaving: false });
    expect(mockUpdateCourseLesson).not.toHaveBeenCalled();
  });

  it('keeps lessons visible after section deletion and assigns them to another section', async () => {
    const lesson = { id: 90, course_id: 42, section_id: 5, title: 'Retained lesson', content_type: 'text' as const, position: 0, is_preview: false };
    mockDeleteCourseSection.mockResolvedValue(undefined);
    mockUpdateCourseLesson.mockResolvedValue({ ...lesson, section_id: 6 });
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Original', [lesson]), section(6, 'Destination')]} />);
    fireEvent.press(screen.getAllByLabelText('Delete section')[0]!);
    await waitFor(() => expect(screen.getByText('Lessons without a section')).toBeTruthy());
    expect(screen.getByText('Retained lesson')).toBeTruthy();
    fireEvent.press(screen.getByText('Destination'));
    await waitFor(() => expect(mockUpdateCourseLesson).toHaveBeenCalledWith(42, 90, { section_id: 6, position: 0 }));
    await waitFor(() => expect(screen.queryByText('Lessons without a section')).toBeNull());
    expect(screen.getByText('Retained lesson')).toBeTruthy();
  });

  it('hydrates an unassigned lesson and keeps it available after a failed assignment for retry', async () => {
    const lesson = { id: 90, course_id: 42, section_id: null, title: 'Preserved', content_type: 'text' as const, position: 0, is_preview: false };
    mockUpdateCourseLesson.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ ...lesson, section_id: 6 });
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(6, 'Destination')]} initialUnassignedLessons={[lesson]} />);
    await act(async () => fireEvent.press(screen.getByText('Destination')));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    expect(screen.getByText('Preserved')).toBeTruthy();
    expect(screen.getByText('Lessons without a section')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByText('Destination')));
    await waitFor(() => expect(screen.queryByText('Lessons without a section')).toBeNull());
    expect(mockUpdateCourseLesson).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Preserved')).toBeTruthy();
  });

  it('blocks repeated assignment taps and ignores a departed failure', async () => {
    const lesson = { id: 90, course_id: 42, section_id: null, title: 'Preserved', content_type: 'text' as const, position: 0, is_preview: false };
    let rejectSave!: (error: Error) => void;
    mockUpdateCourseLesson.mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; }));
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(6, 'Destination')]} initialUnassignedLessons={[lesson]} />);
    act(() => { fireEvent.press(screen.getByText('Destination')); fireEvent.press(screen.getByText('Destination')); });
    expect(mockUpdateCourseLesson).toHaveBeenCalledTimes(1);
    screen.unmount();
    await act(async () => rejectSave(new Error('Offline')));
    expect(mockShowToast).not.toHaveBeenCalled();
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

  it('uses one atomic section move and waits for confirmation before changing order', async () => {
    let resolveMove!: (value: object) => void;
    mockReorderSections.mockImplementationOnce(() => new Promise(resolve => { resolveMove = resolve; }));
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Week one'), section(6, 'Week two')]} />);
    const move = screen.getAllByLabelText('Move down')[0]!;
    fireEvent.press(move);
    fireEvent.press(move);
    await waitFor(() => expect(mockReorderSections).toHaveBeenCalledTimes(1));
    expect(mockReorderSections).toHaveBeenCalledWith(42, [5, 6], [6, 5]);
    expect(mockUpdateCourseSection).not.toHaveBeenCalled();
    expect(screen.getAllByDisplayValue(/Week/).map(field => field.props.value)).toEqual(['Week one', 'Week two']);
    await act(async () => resolveMove({ ordered_ids: [6, 5] }));
    expect(screen.getAllByDisplayValue(/Week/).map(field => field.props.value)).toEqual(['Week two', 'Week one']);
  });

  it('uses one atomic lesson move while preserving the open lesson draft', async () => {
    const lessons = [90, 91].map(id => ({ id, course_id: 42, section_id: 5, title: 'Lesson ' + id, content_type: 'text' as const, position: id - 90, is_preview: false }));
    mockReorderLessons.mockResolvedValue({ ordered_ids: [91, 90] });
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Week one', lessons)]} />);
    fireEvent.press(screen.getByLabelText('Lesson 90'));
    fireEvent.changeText(screen.getByLabelText('Lesson title'), 'Unsent title');
    fireEvent.press(screen.getAllByLabelText('Move down')[1]!);
    await waitFor(() => expect(mockReorderLessons).toHaveBeenCalledWith(42, 5, [90, 91], [91, 90]));
    expect(mockUpdateCourseLesson).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Unsent title')).toBeTruthy();
    const ids = screen.getAllByTestId(/course-lesson-.*-header/).map(row => row.props.testID);
    expect(ids).toEqual(['course-lesson-91-header', 'course-lesson-90-header']);
  });

  it('reads the accepted order after a lost response without discarding a title draft', async () => {
    mockReorderSections.mockRejectedValue(new Error('Lost response'));
    mockGetCourse.mockResolvedValue({ id: 42, sections: [section(6, 'Week two'), section(5, 'Week one')] });
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Week one'), section(6, 'Week two')]} />);
    fireEvent.changeText(screen.getByDisplayValue('Week one'), 'Unsent name');
    fireEvent.press(screen.getAllByLabelText('Move down')[0]!);
    await waitFor(() => expect(mockGetCourse).toHaveBeenCalledWith(42));
    await waitFor(() => expect(screen.getAllByLabelText('Section title').map(field => field.props.value)).toEqual(['Week two', 'Unsent name']));
    expect(mockReorderSections).toHaveBeenCalledTimes(1);
  });

  it('locks further moves after failed readback and retries only the read', async () => {
    mockReorderSections.mockRejectedValue(new Error('Lost response'));
    mockGetCourse.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ id: 42, sections: [section(6, 'Week two'), section(5, 'Week one')] });
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Week one'), section(6, 'Week two')]} />);
    fireEvent.press(screen.getAllByLabelText('Move down')[0]!);
    await waitFor(() => expect(screen.getByLabelText('Retry')).toBeTruthy());
    fireEvent.press(screen.getAllByLabelText('Move down')[0]!);
    expect(mockReorderSections).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.press(screen.getByLabelText('Retry')));
    await waitFor(() => expect(mockGetCourse).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByLabelText('Retry')).toBeNull());
    expect(mockGetCourse).toHaveBeenCalledTimes(2);
    expect(mockReorderSections).toHaveBeenCalledTimes(1);
    expect(screen.getAllByDisplayValue(/Week/).map(field => field.props.value)).toEqual(['Week two', 'Week one']);
  });

  it('does not replace a lesson accepted while an order readback was pending', async () => {
    let resolveRead!: (value: object) => void;
    mockReorderSections.mockRejectedValue(new Error('Lost response'));
    mockGetCourse.mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve; }));
    const savedLesson = { id: 90, course_id: 42, section_id: 5, title: 'Saved lesson', content_type: 'text' as const, position: 0, is_preview: false };
    mockCreateCourseLesson.mockResolvedValue(savedLesson);
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Week one'), section(6, 'Week two')]} />);
    fireEvent.press(screen.getAllByLabelText('Move down')[0]!);
    await waitFor(() => expect(mockGetCourse).toHaveBeenCalledTimes(1));
    fireEvent.press(screen.getAllByText('Add lesson')[0]!);
    await waitFor(() => expect(screen.getByText('Saved lesson')).toBeTruthy());
    await act(async () => resolveRead({ id: 42, sections: [section(6, 'Week two'), section(5, 'Week one')] }));
    expect(screen.getByText('Saved lesson')).toBeTruthy();
    expect(screen.getByLabelText('Retry')).toBeTruthy();
    mockGetCourse.mockResolvedValue({ id: 42, sections: [section(6, 'Week two'), section(5, 'Week one', [savedLesson])] });
    await act(async () => fireEvent.press(screen.getByLabelText('Retry')));
    await waitFor(() => expect(screen.queryByLabelText('Retry')).toBeNull());
    expect(screen.getByText('Saved lesson')).toBeTruthy();
  });

  it('recovers a lesson order without replacing its unsaved contents', async () => {
    const lessons = [90, 91].map(id => ({ id, course_id: 42, section_id: 5, title: 'Lesson ' + id, content_type: 'text' as const, position: id - 90, is_preview: false }));
    mockReorderLessons.mockRejectedValue(new Error('Lost response'));
    mockGetCourse.mockResolvedValue({ id: 42, sections: [section(5, 'Week one', [...lessons].reverse())] });
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Week one', lessons)]} />);
    fireEvent.press(screen.getByLabelText('Lesson 90'));
    fireEvent.changeText(screen.getByLabelText('Lesson title'), 'Unsent title');
    fireEvent.press(screen.getAllByLabelText('Move down')[1]!);
    await waitFor(() => expect(mockGetCourse).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByTestId(/course-lesson-.*-header/)[0]!.props.testID).toBe('course-lesson-91-header'));
    expect(screen.getByDisplayValue('Unsent title')).toBeTruthy();
    expect(mockUpdateCourseLesson).not.toHaveBeenCalled();
  });

  it('does not read back or toast an ordering failure after leaving', async () => {
    let rejectMove!: (reason: Error) => void;
    mockReorderSections.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectMove = reject; }));
    const screen = render(<CourseBuilder courseId={42} initialSections={[section(5, 'Week one'), section(6, 'Week two')]} />);
    fireEvent.press(screen.getAllByLabelText('Move down')[0]!);
    screen.unmount();
    await act(async () => rejectMove(new Error('Offline')));
    expect(mockGetCourse).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
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
