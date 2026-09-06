// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 🔴 Audit F03. A `quiz` lesson used to render as its title and a "Mark as complete" button,
 so a learner could pass a graded assessment without ever being shown a question — and the
 app then reported the lesson 100% watched. These cover the journey that replaces it.
*/

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#111', textSecondary: '#555', border: '#ddd',
    error: '#b00', success: '#070', warning: '#a40',
  }),
}));
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/lib/api/courses', () => ({
  getCourseQuiz: jest.fn(),
  submitCourseQuizAttempt: jest.fn(),
}));

import LessonQuiz from './LessonQuiz';
import { getCourseQuiz, submitCourseQuizAttempt } from '@/lib/api/courses';
import { ApiResponseError } from '@/lib/api/client';

const QUIZ = {
  id: 44,
  course_id: 7,
  lesson_id: 12,
  title: 'Check your understanding',
  description: null,
  pass_mark_percent: 60,
  questions: [
    {
      id: 1,
      type: 'mcq' as const,
      prompt: 'What is a time credit?',
      options: [{ id: 'a', label: 'An hour of help' }, { id: 'b', label: 'A discount' }],
    },
    { id: 2, type: 'multi' as const, prompt: 'Pick every module.', options: [{ id: 'x', label: 'Events' }, { id: 'y', label: 'Groups' }] },
    { id: 3, type: 'short' as const, prompt: 'Describe one exchange.', options: null },
  ],
};

describe('LessonQuiz', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getCourseQuiz).mockResolvedValue(QUIZ as never);
    jest.mocked(submitCourseQuizAttempt).mockResolvedValue({
      score_percent: 80, passed: true, needs_review: false, attempt_id: 5,
    });
  });

  it('shows the learner the questions instead of a bare completion button', async () => {
    const { getByText } = render(<LessonQuiz quizId={44} />);

    await waitFor(() => expect(getByText('What is a time credit?')).toBeTruthy());
    expect(getByText('Pick every module.')).toBeTruthy();
    expect(getByText('Describe one exchange.')).toBeTruthy();
  });

  it('submits single answers, multiple answers and free text in the shape the API grades', async () => {
    const { getByText, getByLabelText } = render(<LessonQuiz quizId={44} />);
    await waitFor(() => expect(getByText('An hour of help')).toBeTruthy());

    fireEvent.press(getByText('An hour of help'));
    fireEvent.press(getByText('Events'));
    fireEvent.press(getByText('Groups'));
    fireEvent.changeText(getByLabelText('Describe one exchange.'), 'I fixed a bicycle.');
    fireEvent.press(getByText('quiz.submit'));

    await waitFor(() => expect(submitCourseQuizAttempt).toHaveBeenCalledWith(44, {
      // A single-choice question sends one option id, `multi` an array, free text the string.
      '1': 'a',
      '2': ['x', 'y'],
      '3': 'I fixed a bicycle.',
    }));
  });

  it('replaces a selection on a single-choice question rather than accumulating', async () => {
    const { getByText } = render(<LessonQuiz quizId={44} />);
    await waitFor(() => expect(getByText('An hour of help')).toBeTruthy());

    fireEvent.press(getByText('An hour of help'));
    fireEvent.press(getByText('A discount'));
    fireEvent.press(getByText('quiz.submit'));

    await waitFor(() => expect(submitCourseQuizAttempt).toHaveBeenCalledWith(
      44, expect.objectContaining({ '1': 'b' }),
    ));
  });

  it('shows the score once graded', async () => {
    const { getByTestId, getByText } = render(<LessonQuiz quizId={44} />);
    await waitFor(() => expect(getByText('quiz.submit')).toBeTruthy());

    await act(async () => { fireEvent.press(getByText('quiz.submit')); });

    expect(getByTestId('quiz-result')).toHaveTextContent(/quiz\.passed/);
    expect(getByTestId('quiz-result')).toHaveTextContent(/quiz\.score/);
  });

  it('withholds a score while a human still has to mark the answers', async () => {
    // A percentage next to "submitted for review" would be read as the final result.
    jest.mocked(submitCourseQuizAttempt).mockResolvedValue({
      score_percent: 0, passed: false, needs_review: true, attempt_id: 6,
    });

    const { getByTestId, getByText } = render(<LessonQuiz quizId={44} />);
    await waitFor(() => expect(getByText('quiz.submit')).toBeTruthy());

    await act(async () => { fireEvent.press(getByText('quiz.submit')); });

    expect(getByTestId('quiz-result')).toHaveTextContent('quiz.pending_review');
    expect(getByTestId('quiz-result')).not.toHaveTextContent('quiz.score');
  });

  it('shows the server\'s own reason when an attempt is refused', async () => {
    // MAX_ATTEMPTS_REACHED is final. "Please try again" would be a lie, and hiding the
    // reason leaves a learner pressing a button that cannot ever work.
    jest.mocked(submitCourseQuizAttempt).mockRejectedValue(
      new ApiResponseError(422, 'You have used all your attempts.'),
    );

    const { getByTestId, getByText } = render(<LessonQuiz quizId={44} />);
    await waitFor(() => expect(getByText('quiz.submit')).toBeTruthy());

    await act(async () => { fireEvent.press(getByText('quiz.submit')); });

    expect(getByTestId('quiz-error')).toHaveTextContent('You have used all your attempts.');
  });

  it('offers a retry when the quiz itself could not be loaded', async () => {
    jest.mocked(getCourseQuiz).mockRejectedValue(new ApiResponseError(403, 'This lesson is locked.'));

    const { getByText } = render(<LessonQuiz quizId={44} />);

    await waitFor(() => expect(getByText('This lesson is locked.')).toBeTruthy());
    fireEvent.press(getByText('common:buttons.retry'));
    await waitFor(() => expect(jest.mocked(getCourseQuiz).mock.calls.length).toBeGreaterThan(1));
  });
});
