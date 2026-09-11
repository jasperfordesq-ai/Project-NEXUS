// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';

const mockGetCourseGradingQueue = jest.fn();
const mockGradeCourseAttempt = jest.fn();
const mockShowToast = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: '42' }),
}));

// Resolve against the SHIPPED English copy, so a renamed or missing key fails the test
// rather than being papered over by a hand-written stub map.
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
    textMuted: '#999999', border: '#dddddd', borderSubtle: '#eeeeee', error: '#dc2626',
  }),
}));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn((...args: unknown[]) => mockShowToast(...args));
  return { useAppToast: () => ({ show, hide: jest.fn(), isToastVisible: false }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
// The real Switch cannot be pressed through the testing library; this keeps the pass/fail
// decision assertable while leaving the screen's own wiring under test.
jest.mock('@/components/ui/Toggle', () => {
  const { Text } = require('react-native');
  return function MockToggle({ value, onValueChange, accessibilityLabel }: {
    value: boolean;
    onValueChange: (value: boolean) => void;
    accessibilityLabel: string;
  }) {
    return (
      <Text accessibilityLabel={accessibilityLabel} onPress={() => onValueChange(!value)}>
        {value ? 'on' : 'off'}
      </Text>
    );
  };
});
jest.mock('@/lib/api/courses', () => ({
  getCourseGradingQueue: (...args: unknown[]) => mockGetCourseGradingQueue(...args),
  gradeCourseAttempt: (...args: unknown[]) => mockGradeCourseAttempt(...args),
}));

import CourseGradingRoute, { formatAnswer } from './course-grading';
import { ApiResponseError } from '@/lib/api/client';

const essayQuestion = {
  id: 501,
  type: 'essay' as const,
  prompt: 'Describe a repair you led.',
  options: null,
  points: 5,
  position: 1,
};
const choiceQuestion = {
  id: 502,
  type: 'mcq' as const,
  prompt: 'How many hours is one credit?',
  options: [{ id: 'a', label: 'One hour' }, { id: 'b', label: 'Two hours' }],
  points: 1,
  position: 2,
};

const attempt = {
  id: 900,
  quiz_id: 11,
  user_id: 77,
  answers: { '501': 'I fixed a kettle with a neighbour.', '502': 'a' },
  score_percent: 0,
  grading_status: 'pending_review',
  submitted_at: '2026-09-01T10:00:00Z',
  quiz: { id: 11, title: 'End of course quiz', questions: [essayQuestion, choiceQuestion] },
  user: { id: 77, name: 'Maura Byrne', avatar_url: null },
};

describe('CourseGradingRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShowToast.mockClear();
    mockGetCourseGradingQueue.mockResolvedValue([attempt]);
    mockGradeCourseAttempt.mockResolvedValue({ ...attempt, grading_status: 'graded' });
  });

  it('reads the queue for the course in the URL, not for every course', async () => {
    render(<CourseGradingRoute />);

    await waitFor(() => expect(mockGetCourseGradingQueue).toHaveBeenCalledWith(42));
  });

  it('retains a grading draft while refreshing the queue', async () => {
    const screen = render(<CourseGradingRoute />);
    await waitFor(() => expect(screen.getByText('Maura Byrne')).toBeTruthy());
    fireEvent.changeText(screen.getByLabelText('Feedback (optional)'), 'Detailed unsent feedback');
    let finish!: (value: unknown) => void;
    mockGetCourseGradingQueue.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => { screen.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
    expect(screen.getByLabelText('Feedback (optional)').props.value).toBe('Detailed unsent feedback');
    await act(async () => { finish([attempt]); });
    expect(screen.getByLabelText('Feedback (optional)').props.value).toBe('Detailed unsent feedback');
    mockGetCourseGradingQueue.mockRejectedValueOnce(new ApiResponseError(400, 'Refresh failed'));
    await act(async () => { screen.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
    expect(screen.getByTestId('refresh-failed-notice')).toBeTruthy();
    expect(screen.getByLabelText('Feedback (optional)').props.value).toBe('Detailed unsent feedback');
  });

  it('pauses grade edits while saving and restores the draft after rejection', async () => {
    const screen = render(<CourseGradingRoute />);
    await waitFor(() => expect(screen.getByText('Maura Byrne')).toBeTruthy());
    fireEvent.changeText(screen.getByLabelText('Score (%)'), '85');
    fireEvent.changeText(screen.getByLabelText('Feedback (optional)'), 'Keep this feedback');
    let reject!: (reason: Error) => void;
    mockGradeCourseAttempt.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    fireEvent.press(screen.getByText('Submit grade'));
    expect(screen.getByLabelText('Score (%)').props.editable).toBe(false);
    expect(screen.getByLabelText('Feedback (optional)').props.editable).toBe(false);
    await act(async () => { reject(new ApiResponseError(422, 'Please review the grade')); });
    expect(screen.getByLabelText('Score (%)').props.editable).toBe(true);
    expect(screen.getByLabelText('Feedback (optional)').props.value).toBe('Keep this feedback');
    await act(async () => { fireEvent.press(screen.getByText('Submit grade')); });
    expect(mockGradeCourseAttempt).toHaveBeenLastCalledWith(900, { score_percent: 85, passed: true, feedback: 'Keep this feedback' });
    expect(screen.queryByText('Maura Byrne')).toBeNull();
  });

  it('shows who is waiting, the question prompts and the member\'s answers in words', async () => {
    const { getByText } = render(<CourseGradingRoute />);

    await waitFor(() => expect(getByText('Maura Byrne')).toBeTruthy());
    expect(getByText('End of course quiz')).toBeTruthy();
    expect(getByText('Describe a repair you led.')).toBeTruthy();
    expect(getByText('Answer: I fixed a kettle with a neighbour.')).toBeTruthy();
    // The stored value is the option id 'a'; the grader must see the option's LABEL.
    expect(getByText('Answer: One hour')).toBeTruthy();
  });

  it('says "no answer" instead of a blank line when a question was skipped', async () => {
    mockGetCourseGradingQueue.mockResolvedValue([{ ...attempt, answers: { '502': 'b' } }]);

    const { getByText } = render(<CourseGradingRoute />);

    await waitFor(() => expect(getByText('Answer: No answer')).toBeTruthy());
    expect(getByText('Answer: Two hours')).toBeTruthy();
  });

  it('falls back to readable lines when the question metadata is missing', async () => {
    mockGetCourseGradingQueue.mockResolvedValue([{
      ...attempt,
      quiz: { id: 11, title: 'End of course quiz' },
      answers: { '501': ['a', 'b'] },
    }]);

    const { getByText } = render(<CourseGradingRoute />);

    await waitFor(() => expect(getByText('#501: a, b')).toBeTruthy());
  });

  it('posts the score, pass decision and trimmed feedback, then drops the row from the queue', async () => {
    const { getByLabelText, getByText, queryByText } = render(<CourseGradingRoute />);
    await waitFor(() => expect(getByText('Maura Byrne')).toBeTruthy());

    fireEvent.changeText(getByLabelText('Score (%)'), '85');
    fireEvent.changeText(getByLabelText('Feedback (optional)'), '  Well argued.  ');
    fireEvent.press(getByText('Submit grade'));

    await waitFor(() => expect(mockGradeCourseAttempt).toHaveBeenCalledWith(900, {
      score_percent: 85,
      passed: true,
      feedback: 'Well argued.',
    }));
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Grade saved',
      variant: 'success',
    }));
    // The graded attempt leaves the queue immediately, without waiting for a re-read.
    await waitFor(() => expect(queryByText('Maura Byrne')).toBeNull());
    expect(getByText('Nothing to grade right now.')).toBeTruthy();
  });

  it('🔴 records a comma decimal as the mark the instructor meant, not zero', async () => {
    /*
      `Number(score) || 0` turned "82,5" into a real, wrong mark of ZERO — silently, with
      a success toast, on any device in a comma-decimal locale (de, es, fr, it, pt). Any
      other typo did the same. Found by the 2026-09-07 audit (G/F-9).
    */
    const { getByLabelText, getByText } = render(<CourseGradingRoute />);
    await waitFor(() => expect(getByText('Maura Byrne')).toBeTruthy());

    fireEvent.changeText(getByLabelText('Score (%)'), '82,5');
    fireEvent.press(getByText('Submit grade'));

    await waitFor(() => expect(mockGradeCourseAttempt).toHaveBeenCalledWith(
      900,
      expect.objectContaining({ score_percent: 82.5 }),
    ));
  });

  it('🔴 refuses a grade that is not a number, rather than recording zero', async () => {
    const { getByLabelText, getByText } = render(<CourseGradingRoute />);
    await waitFor(() => expect(getByText('Maura Byrne')).toBeTruthy());

    fireEvent.changeText(getByLabelText('Score (%)'), 'abc');
    fireEvent.press(getByText('Submit grade'));

    expect(mockGradeCourseAttempt).not.toHaveBeenCalled();
  });

  it('sends passed:false once the grader marks the attempt as a fail', async () => {
    const { getByLabelText, getByText } = render(<CourseGradingRoute />);
    await waitFor(() => expect(getByText('Maura Byrne')).toBeTruthy());

    fireEvent.changeText(getByLabelText('Score (%)'), '20');
    fireEvent.press(getByLabelText('Passed'));
    fireEvent.press(getByText('Submit grade'));

    await waitFor(() => expect(mockGradeCourseAttempt).toHaveBeenCalledWith(900, {
      score_percent: 20,
      passed: false,
      feedback: '',
    }));
  });

  it('keeps the attempt in the queue and explains a refused grade', async () => {
    mockGradeCourseAttempt.mockRejectedValue(new ApiResponseError(422, 'This attempt was already graded.'));

    const { getByText } = render(<CourseGradingRoute />);
    await waitFor(() => expect(getByText('Maura Byrne')).toBeTruthy());

    fireEvent.press(getByText('Submit grade'));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Could not save the grade.',
      description: 'This attempt was already graded.',
      variant: 'danger',
    })));
    expect(getByText('Maura Byrne')).toBeTruthy();
  });

  it('shows the empty state when nothing is awaiting a decision', async () => {
    mockGetCourseGradingQueue.mockResolvedValue([]);

    const { getByText } = render(<CourseGradingRoute />);

    await waitFor(() => expect(getByText('Nothing to grade right now.')).toBeTruthy());
  });

  /**
   * 🔴 This case used to press Retry after a 403 and assert it worked, because the mock
   * was changed to succeed in between. Against the real server it never could: grading is
   * course-owner-only, so somebody who is not the instructor gets the same 403 for ever.
   * The test was pinning the fault. It now asserts the refusal is named as one.
   */
  it('says a grading queue that is not yours is unavailable, with no dead Retry', async () => {
    // A 403 is deliberately NOT one of `useApi`'s retryable statuses, so the failure
    // surfaces immediately instead of after its 2s single-retry timer.
    mockGetCourseGradingQueue.mockRejectedValue(new ApiResponseError(403, 'Only the author can grade.'));

    const { getByTestId, queryByText } = render(<CourseGradingRoute />);

    await waitFor(() => expect(getByTestId('course-grading-refused')).toBeTruthy());
    expect(queryByText('Retry')).toBeNull();
  });

  it('still offers a retry for a server failure, which retrying can fix', async () => {
    mockGetCourseGradingQueue.mockRejectedValue(new ApiResponseError(500, 'Something went wrong.'));

    const { getByText, queryByTestId } = render(<CourseGradingRoute />);

    // useApi retries a 5xx once after 2s before surfacing it.
    await waitFor(() => expect(getByText('Something went wrong.')).toBeTruthy(), { timeout: 5000 });
    expect(queryByTestId('course-grading-refused')).toBeNull();

    mockGetCourseGradingQueue.mockResolvedValue([attempt]);
    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(getByText('Maura Byrne')).toBeTruthy());
  });
});

describe('formatAnswer', () => {
  it('joins multiple chosen options by their labels', () => {
    expect(formatAnswer(choiceQuestion, { '502': ['a', 'b'] })).toBe('One hour, Two hours');
  });

  it('keeps an unknown option id rather than dropping the answer', () => {
    expect(formatAnswer(choiceQuestion, { '502': 'zzz' })).toBe('zzz');
  });

  it('treats a missing, null or empty answer as no answer at all', () => {
    expect(formatAnswer(essayQuestion, null)).toBe('');
    expect(formatAnswer(essayQuestion, {})).toBe('');
    expect(formatAnswer(essayQuestion, { '501': null })).toBe('');
    expect(formatAnswer(essayQuestion, { '501': '' })).toBe('');
  });

  it('does not mistake a legitimate 0 for a missing answer', () => {
    expect(formatAnswer(essayQuestion, { '501': 0 })).toBe('0');
  });
});
