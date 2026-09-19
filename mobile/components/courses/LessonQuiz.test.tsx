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
let mockUserId = 7;
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mockUserId } }) }));
jest.mock('@/lib/hooks/useTenant', () => ({ useTenant: () => ({ tenant: { id: 2 } }) }));
jest.mock('@/lib/storage', () => ({ storage: { get: jest.fn(), set: jest.fn(), getJson: jest.fn(), setJson: jest.fn(), remove: jest.fn() } }));
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

// 🔴 This mock records the question and does NOT answer it. A confirm mock that
// runs `onConfirm` itself makes every confirmation on the screen invisible: the
// tests still pass with the dialog deleted, which is exactly how a one-tap money
// path survived a full suite on member-profile. Each test below runs `onConfirm`
// by hand, so "was the learner asked?" and "what happens if they say yes?" stay
// separate questions.
const mockConfirm = jest.fn<void, [{ title: string; message?: string; onConfirm: () => void }]>();
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({ confirm: (...args: unknown[]) => mockConfirm(...(args as [never])), confirmDialog: null }),
}));

import LessonQuiz from './LessonQuiz';
import { getCourseQuiz, submitCourseQuizAttempt } from '@/lib/api/courses';
import { ApiResponseError } from '@/lib/api/client';
import { storage } from '@/lib/storage';
import { loadQuizAttempt, prepareQuizAttempt, rejectQuizAttempt } from '@/lib/quizAttemptStore';
const savedValues = new Map<string, string>();

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
    mockUserId = 7;
    savedValues.clear();
    jest.mocked(storage.get).mockImplementation(async key => savedValues.get(key) ?? null);
    jest.mocked(storage.set).mockImplementation(async (key, value) => { savedValues.set(key, value); });
    jest.mocked(storage.getJson).mockImplementation(async key => {
      const raw = savedValues.get(key); return raw === undefined ? null : JSON.parse(raw);
    });
    jest.mocked(storage.setJson).mockImplementation(async (key, value) => { savedValues.set(key, JSON.stringify(value)); });
    jest.mocked(storage.remove).mockImplementation(async key => { savedValues.delete(key); });
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

  it('does not send after leaving while the saved identity is still being committed', async () => {
    const screen = render(<LessonQuiz quizId={44} />);
    await screen.findByText('An hour of help');
    fireEvent.press(screen.getByText('An hour of help'));
    fireEvent.press(screen.getByTestId('quiz-submit'));
    let finishSave!: () => void;
    jest.mocked(storage.setJson).mockImplementationOnce((key, value) => new Promise(resolve => {
      finishSave = () => { savedValues.set(key, JSON.stringify(value)); resolve(); };
    }));
    let completion: unknown;
    act(() => { completion = mockConfirm.mock.calls[0][0].onConfirm(); });
    await waitFor(() => expect(finishSave).toBeDefined());
    screen.unmount();
    await act(async () => { finishSave(); await completion; });
    expect(submitCourseQuizAttempt).not.toHaveBeenCalled();
    await expect(loadQuizAttempt({ tenantId: 2, userId: 7, quizId: 44 })).resolves.toMatchObject({ status: 'pending' });
  });

  it('replays the same identity after a failed acknowledgement write and remount', async () => {
    jest.mocked(submitCourseQuizAttempt).mockImplementationOnce(async () => {
      jest.mocked(storage.setJson).mockRejectedValueOnce(new Error('Receipt write failed'));
      return { score_percent: 80, passed: true, needs_review: false, attempt_id: 5 };
    });
    const screen = render(<LessonQuiz quizId={44} />);
    await screen.findByText('An hour of help');
    fireEvent.press(screen.getByText('An hour of help'));
    fireEvent.press(screen.getByTestId('quiz-submit'));
    await act(async () => { await mockConfirm.mock.calls[0][0].onConfirm(); });
    expect(screen.getByTestId('quiz-result')).toBeTruthy();
    expect(screen.getByTestId('quiz-pending')).toBeTruthy();
    const original = jest.mocked(submitCourseQuizAttempt).mock.calls[0];
    screen.unmount();
    const restored = render(<LessonQuiz quizId={44} />);
    await restored.findByTestId('quiz-pending');
    fireEvent.press(restored.getByTestId('quiz-submit'));
    await waitFor(() => expect(submitCourseQuizAttempt).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(restored.queryByText('quiz.submitting')).toBeNull());
    expect(restored.queryByTestId('quiz-error')?.props.children).toBeUndefined();
    await waitFor(() => expect(restored.queryByTestId('quiz-pending')).toBeNull());
    expect(jest.mocked(submitCourseQuizAttempt).mock.calls[1]).toEqual(original);
  });

  it('saves a late receipt for its original owner without changing the new account screen', async () => {
    let finish!: (value: Awaited<ReturnType<typeof submitCourseQuizAttempt>>) => void;
    jest.mocked(submitCourseQuizAttempt).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const screen = render(<LessonQuiz quizId={44} />);
    await screen.findByText('An hour of help');
    fireEvent.press(screen.getByText('An hour of help'));
    fireEvent.press(screen.getByTestId('quiz-submit'));
    let completion: unknown;
    act(() => { completion = mockConfirm.mock.calls[0][0].onConfirm(); });
    await waitFor(() => expect(submitCourseQuizAttempt).toHaveBeenCalledTimes(1));
    mockUserId = 8;
    screen.rerender(<LessonQuiz quizId={44} />);
    await screen.findByText('An hour of help');
    await act(async () => { finish({ score_percent: 80, passed: true, needs_review: false, attempt_id: 5 }); await completion; });
    expect(screen.queryByTestId('quiz-result')).toBeNull();
    await expect(loadQuizAttempt({ tenantId: 2, userId: 7, quizId: 44 })).resolves.toMatchObject({ status: 'acknowledged' });
    await expect(loadQuizAttempt({ tenantId: 2, userId: 8, quizId: 44 })).resolves.toBeNull();
  });

  it('restores an uncertain attempt after remount and replays its exact key and answers', async () => {
    jest.mocked(submitCourseQuizAttempt).mockRejectedValueOnce(new ApiResponseError(0, 'Response lost'));
    const first = render(<LessonQuiz quizId={44} />);
    await first.findByText('An hour of help');
    fireEvent.press(first.getByText('An hour of help'));
    fireEvent.press(first.getByTestId('quiz-submit'));
    await act(async () => { await mockConfirm.mock.calls[0][0].onConfirm(); });
    const originalCall = jest.mocked(submitCourseQuizAttempt).mock.calls[0];
    first.unmount();
    const restored = render(<LessonQuiz quizId={44} />);
    await restored.findByTestId('quiz-pending');
    expect(restored.getByLabelText('Describe one exchange.').props.editable).toBe(false);
    fireEvent.press(restored.getByText('A discount'));
    fireEvent.press(restored.getByTestId('quiz-submit'));
    await restored.findByTestId('quiz-result');
    expect(jest.mocked(submitCourseQuizAttempt).mock.calls[1]).toEqual(originalCall);
    await waitFor(() => expect(restored.queryByTestId('quiz-pending')).toBeNull());
  });

  it('blocks submission when recovery storage cannot be read and allows retry', async () => {
    jest.mocked(storage.get).mockRejectedValueOnce(new Error('Keystore unavailable'));
    const screen = render(<LessonQuiz quizId={44} />);
    await screen.findByText('quiz.storage_failed');
    expect(screen.queryByTestId('quiz-submit')).toBeNull();
    expect(submitCourseQuizAttempt).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('common:buttons.retry'));
    await screen.findByText('An hour of help');
  });

  it('does not send an attempt when saving its identity fails', async () => {
    const screen = render(<LessonQuiz quizId={44} />);
    await screen.findByText('An hour of help');
    fireEvent.press(screen.getByText('An hour of help'));
    fireEvent.press(screen.getByTestId('quiz-submit'));
    jest.mocked(storage.setJson).mockRejectedValueOnce(new Error('Write failed'));
    await act(async () => { await mockConfirm.mock.calls[0][0].onConfirm(); });
    expect(screen.getByText('quiz.storage_failed')).toBeTruthy();
    expect(submitCourseQuizAttempt).not.toHaveBeenCalled();
  });

  it('reuses the identity after response loss and rotates it after acknowledged success', async () => {
    jest.mocked(submitCourseQuizAttempt).mockRejectedValueOnce(new ApiResponseError(0, 'Response lost'));
    const screen = render(<LessonQuiz quizId={44} />);
    await screen.findByText('An hour of help');
    fireEvent.press(screen.getByText('An hour of help'));
    fireEvent.press(screen.getByText('Events'));
    fireEvent.changeText(screen.getByLabelText('Describe one exchange.'), 'My answer');
    fireEvent.press(screen.getByTestId('quiz-submit'));
    await screen.findByText('Response lost');
    const firstKey = jest.mocked(submitCourseQuizAttempt).mock.calls[0][2];
    expect(firstKey).toEqual(expect.any(String));
    fireEvent.press(screen.getByTestId('quiz-submit'));
    await screen.findByTestId('quiz-result');
    expect(jest.mocked(submitCourseQuizAttempt).mock.calls[1][2]).toBe(firstKey);
    fireEvent.press(screen.getByTestId('quiz-submit'));
    await waitFor(() => expect(submitCourseQuizAttempt).toHaveBeenCalledTimes(3));
    expect(jest.mocked(submitCourseQuizAttempt).mock.calls[2][2]).not.toBe(firstKey);
  });

  it('stops further submissions after the server reports the attempt limit', async () => {
    jest.mocked(submitCourseQuizAttempt).mockRejectedValueOnce(new ApiResponseError(422, 'No attempts remain', undefined, 'MAX_ATTEMPTS_REACHED'));
    const screen = render(<LessonQuiz quizId={44} />);
    await screen.findByText('An hour of help');
    fireEvent.press(screen.getByText('An hour of help'));
    fireEvent.press(screen.getByTestId('quiz-submit'));
    const confirm = mockConfirm.mock.calls[0][0].onConfirm;
    await act(async () => { await confirm(); });
    await screen.findByText('No attempts remain');
    await act(async () => { await confirm(); });
    fireEvent.press(screen.getByTestId('quiz-submit'));
    expect(submitCourseQuizAttempt).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledTimes(1);
  });

  it('does not offer a new attempt when the fetched count is exhausted', async () => {
    jest.mocked(getCourseQuiz).mockResolvedValue({ ...QUIZ, attempts_remaining: 0 } as never);
    const screen = render(<LessonQuiz quizId={44} />);
    await screen.findByText('An hour of help');
    fireEvent.press(screen.getByText('An hour of help'));
    fireEvent.press(screen.getByTestId('quiz-submit'));
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(submitCourseQuizAttempt).not.toHaveBeenCalled();
    expect(screen.queryByText('quiz.retry')).toBeNull();
    expect(screen.getByTestId('quiz-submit')).toHaveTextContent('quiz.attempts_exhausted');
  });

  it('shows the server grade without a local receipt and does not invite exhausted answers', async () => {
    jest.mocked(getCourseQuiz).mockResolvedValue({ ...QUIZ, attempts_remaining: 0, latest_attempt: { attempt_id: 90, score_percent: 85, passed: true, needs_review: false } } as never);
    const screen = render(<LessonQuiz quizId={44} />);
    await waitFor(() => expect(screen.getByTestId('quiz-result')).toHaveTextContent(/quiz\.passed/));
    expect(screen.queryByTestId('quiz-nothing-answered')).toBeNull();
    expect(screen.getByLabelText('Describe one exchange.').props.editable).toBe(false);
    expect(submitCourseQuizAttempt).not.toHaveBeenCalled();
  });

  it('does not restore a remote result over a newly edited answer on refresh', async () => {
    jest.mocked(getCourseQuiz).mockResolvedValue({ ...QUIZ, attempts_remaining: 1, latest_attempt: { attempt_id: 90, score_percent: 40, passed: false, needs_review: false } } as never);
    const screen = render(<LessonQuiz quizId={44} gradeRevision={0} />);
    await screen.findByTestId('quiz-result');
    fireEvent.changeText(screen.getByLabelText('Describe one exchange.'), 'New answer');
    expect(screen.queryByTestId('quiz-result')).toBeNull();
    screen.rerender(<LessonQuiz quizId={44} gradeRevision={1} />);
    await waitFor(() => expect(getCourseQuiz).toHaveBeenCalledTimes(2));
    await screen.findByText('An hour of help');
    expect(screen.getByLabelText('Describe one exchange.').props.value).toBe('New answer');
    expect(screen.queryByTestId('quiz-result')).toBeNull();
  });

  it.each([1, null, 0, undefined])('reconciles a saved limit refusal with fresh remaining count %s', async (remaining) => {
    const scope = { tenantId: 2, userId: 7, quizId: 44 };
    const prior = await prepareQuizAttempt(scope, { '1': 'a' });
    await rejectQuizAttempt(scope, prior.key, 'MAX_ATTEMPTS_REACHED');
    jest.mocked(getCourseQuiz).mockResolvedValue({ ...QUIZ, attempts_remaining: remaining } as never);
    const screen = render(<LessonQuiz quizId={44} />);
    await screen.findByText('An hour of help');
    fireEvent.press(screen.getByTestId('quiz-submit'));
    if (remaining === 1 || remaining === null) {
      expect(mockConfirm).toHaveBeenCalledTimes(1);
      await act(async () => { await mockConfirm.mock.calls[0][0].onConfirm(); });
      await waitFor(() => expect(submitCourseQuizAttempt).toHaveBeenCalledTimes(1));
      expect(jest.mocked(submitCourseQuizAttempt).mock.calls[0][1]).toEqual(prior.answers);
      expect(jest.mocked(submitCourseQuizAttempt).mock.calls[0][2]).not.toBe(prior.key);
    } else {
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(submitCourseQuizAttempt).not.toHaveBeenCalled();
    }
  });

  it('stops new attempts immediately after the last accepted submission, even after editing', async () => {
    jest.mocked(getCourseQuiz).mockResolvedValue({ ...QUIZ, attempts_remaining: 1 } as never);
    jest.mocked(submitCourseQuizAttempt).mockResolvedValue({ attempt_id: 5, score_percent: 80, passed: true, needs_review: false, attempts_remaining: 0 });
    const screen = render(<LessonQuiz quizId={44} />);
    await screen.findByText('An hour of help');
    fireEvent.press(screen.getByText('An hour of help'));
    fireEvent.press(screen.getByText('Events'));
    fireEvent.changeText(screen.getByLabelText('Describe one exchange.'), 'A repair.');
    await act(async () => { fireEvent.press(screen.getByTestId('quiz-submit')); });
    await waitFor(() => expect(screen.queryByTestId('quiz-pending')).toBeNull());
    expect(screen.getByTestId('quiz-submit')).toHaveTextContent('quiz.attempts_exhausted');
    fireEvent.changeText(screen.getByLabelText('Describe one exchange.'), 'A different repair.');
    fireEvent.press(screen.getByTestId('quiz-submit'));
    expect(submitCourseQuizAttempt).toHaveBeenCalledTimes(1);
  });

  it('can recover a pending receipt even when the server reports no new attempts remain', async () => {
    const pending = await prepareQuizAttempt({ tenantId: 2, userId: 7, quizId: 44 }, { '1': 'a' });
    jest.mocked(getCourseQuiz).mockResolvedValue({ ...QUIZ, attempts_remaining: 0 } as never);
    jest.mocked(submitCourseQuizAttempt).mockResolvedValue({ attempt_id: 5, score_percent: 80, passed: true, needs_review: false, attempts_remaining: 0 });
    const screen = render(<LessonQuiz quizId={44} />);
    await screen.findByText('quiz.recover_attempt');
    await act(async () => { fireEvent.press(screen.getByTestId('quiz-submit')); });
    await waitFor(() => expect(screen.queryByTestId('quiz-pending')).toBeNull());
    expect(submitCourseQuizAttempt).toHaveBeenCalledWith(44, pending.answers, pending.key);
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('quiz-submit')).toHaveTextContent('quiz.attempts_exhausted');
  });

  it.each(['choice', 'text'])('removes an earlier score when editing a %s answer', async (kind) => {
    const screen = render(<LessonQuiz quizId={44} />);
    await screen.findByText('An hour of help');
    fireEvent.press(screen.getByText('An hour of help'));
    fireEvent.press(screen.getByTestId('quiz-submit'));
    await act(async () => { await mockConfirm.mock.calls[0][0].onConfirm(); });
    expect(screen.getByTestId('quiz-result')).toBeTruthy();
    if (kind === 'choice') fireEvent.press(screen.getByText('A discount'));
    else fireEvent.changeText(screen.getByLabelText('Describe one exchange.'), 'A new answer');
    expect(screen.queryByTestId('quiz-result')).toBeNull();
  });

  it('does not present the previous score during a new attempt or its failure', async () => {
    const screen = render(<LessonQuiz quizId={44} />);
    await screen.findByText('An hour of help');
    fireEvent.press(screen.getByText('An hour of help'));
    fireEvent.press(screen.getByTestId('quiz-submit'));
    await act(async () => { await mockConfirm.mock.calls[0][0].onConfirm(); });
    expect(screen.getByTestId('quiz-result')).toBeTruthy();
    let fail!: (reason: Error) => void;
    jest.mocked(submitCourseQuizAttempt).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    fireEvent.press(screen.getByTestId('quiz-submit'));
    act(() => { mockConfirm.mock.calls[1][0].onConfirm(); });
    expect(screen.queryByTestId('quiz-result')).toBeNull();
    await waitFor(() => expect(submitCourseQuizAttempt).toHaveBeenCalledTimes(2));
    await act(async () => { fail(new ApiResponseError(422, 'Submission rejected')); });
    expect(screen.queryByTestId('quiz-result')).toBeNull();
    expect(screen.getByTestId('quiz-error')).toHaveTextContent('Submission rejected');
  });

  it('ignores an incomplete-quiz confirmation after leaving', async () => {
    const screen = render(<LessonQuiz quizId={44} />);
    await screen.findByText('An hour of help');
    fireEvent.press(screen.getByText('An hour of help'));
    fireEvent.press(screen.getByTestId('quiz-submit'));
    const confirm = mockConfirm.mock.calls[0][0].onConfirm;
    screen.unmount();
    await act(async () => { await confirm(); });
    expect(submitCourseQuizAttempt).not.toHaveBeenCalled();
  });

  it('submits once when the same confirmation is invoked twice before a render', async () => {
    let finish!: (value: Awaited<ReturnType<typeof submitCourseQuizAttempt>>) => void;
    jest.mocked(submitCourseQuizAttempt).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const screen = render(<LessonQuiz quizId={44} />);
    await screen.findByText('An hour of help');
    fireEvent.press(screen.getByText('An hour of help'));
    fireEvent.press(screen.getByTestId('quiz-submit'));
    const confirm = mockConfirm.mock.calls[0][0].onConfirm;
    act(() => { confirm(); confirm(); });
    await waitFor(() => expect(submitCourseQuizAttempt).toHaveBeenCalledTimes(1));
    await act(async () => { finish({ score_percent: 80, passed: true, needs_review: false, attempt_id: 5 }); });
  });

  it('clears answers and invalidates confirmation when the quiz changes', async () => {
    const screen = render(<LessonQuiz quizId={44} />);
    await screen.findByText('An hour of help');
    fireEvent.press(screen.getByText('An hour of help'));
    fireEvent.changeText(screen.getByLabelText('Describe one exchange.'), 'My old answer');
    fireEvent.press(screen.getByTestId('quiz-submit'));
    const confirm = mockConfirm.mock.calls[0][0].onConfirm;
    jest.mocked(getCourseQuiz).mockResolvedValueOnce({ ...QUIZ, id: 45 } as never);
    screen.rerender(<LessonQuiz quizId={45} />);
    await screen.findByText('An hour of help');
    expect(screen.getByLabelText('Describe one exchange.').props.value).toBe('');
    await act(async () => { await confirm(); });
    expect(submitCourseQuizAttempt).not.toHaveBeenCalled();
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
    }, expect.any(String)));
  });

  it('replaces a selection on a single-choice question rather than accumulating', async () => {
    const { getByLabelText, getByText } = render(<LessonQuiz quizId={44} />);
    await waitFor(() => expect(getByText('An hour of help')).toBeTruthy());

    fireEvent.press(getByText('An hour of help'));
    fireEvent.press(getByText('A discount'));
    // Answer the rest so this stays a test about single-choice replacement rather
    // than about the unfinished-quiz confirmation.
    fireEvent.press(getByText('Events'));
    fireEvent.changeText(getByLabelText('Describe one exchange.'), 'A repair.');
    fireEvent.press(getByText('quiz.submit'));

    await waitFor(() => expect(submitCourseQuizAttempt).toHaveBeenCalledWith(
      44, expect.objectContaining({ '1': 'b' }), expect.any(String),
    ));
  });

  it('shows the score once graded', async () => {
    const { getByLabelText, getByTestId, getByText } = render(<LessonQuiz quizId={44} />);
    await waitFor(() => expect(getByText('quiz.submit')).toBeTruthy());

    fireEvent.press(getByText('An hour of help'));
    fireEvent.press(getByText('Events'));
    fireEvent.changeText(getByLabelText('Describe one exchange.'), 'A repair.');
    await act(async () => { fireEvent.press(getByText('quiz.submit')); });

    expect(getByTestId('quiz-result')).toHaveTextContent(/quiz\.passed/);
    expect(getByTestId('quiz-result')).toHaveTextContent(/quiz\.score/);
  });

  it.each([6, 99])('refreshes only the matching submitted receipt after instructor grading (attempt %s)', async (attemptId) => {
    jest.mocked(submitCourseQuizAttempt).mockResolvedValue({ score_percent: 0, passed: false, needs_review: true, attempt_id: 6 });
    const onResolved = jest.fn();
    const screen = render(<LessonQuiz quizId={44} onAttemptResolved={onResolved} gradeRevision={0} />);
    await waitFor(() => expect(screen.getByText('quiz.submit')).toBeTruthy());
    fireEvent.press(screen.getByText('An hour of help'));
    fireEvent.press(screen.getByText('Events'));
    fireEvent.changeText(screen.getByLabelText('Describe one exchange.'), 'A repair.');
    await act(async () => { fireEvent.press(screen.getByText('quiz.submit')); });
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('quiz-result')).toHaveTextContent('quiz.pending_review');
    jest.mocked(getCourseQuiz).mockResolvedValue({ ...QUIZ, latest_attempt: { attempt_id: attemptId, score_percent: 85, passed: true, needs_review: false } } as never);
    screen.rerender(<LessonQuiz quizId={44} onAttemptResolved={onResolved} gradeRevision={1} />);
    await waitFor(() => expect(getCourseQuiz).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('quiz-result')).toHaveTextContent(attemptId === 6 ? /quiz\.passed/ : /quiz\.pending_review/));
    expect(screen.getByLabelText('Describe one exchange.').props.value).toBe('A repair.');
    expect(submitCourseQuizAttempt).toHaveBeenCalledTimes(1);
  });

  it('withholds a score while a human still has to mark the answers', async () => {
    // A percentage next to "submitted for review" would be read as the final result.
    jest.mocked(submitCourseQuizAttempt).mockResolvedValue({
      score_percent: 0, passed: false, needs_review: true, attempt_id: 6,
    });

    const { getByLabelText, getByTestId, getByText } = render(<LessonQuiz quizId={44} />);
    await waitFor(() => expect(getByText('quiz.submit')).toBeTruthy());

    fireEvent.press(getByText('An hour of help'));
    fireEvent.press(getByText('Events'));
    fireEvent.changeText(getByLabelText('Describe one exchange.'), 'A repair.');
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

    const { getByLabelText, getByTestId, getByText } = render(<LessonQuiz quizId={44} />);
    await waitFor(() => expect(getByText('quiz.submit')).toBeTruthy());

    fireEvent.press(getByText('An hour of help'));
    fireEvent.press(getByText('Events'));
    fireEvent.changeText(getByLabelText('Describe one exchange.'), 'A repair.');
    await act(async () => { fireEvent.press(getByText('quiz.submit')); });

    expect(getByTestId('quiz-error')).toHaveTextContent('You have used all your attempts.');
  });

  it.each([401, 403, 404])('does not offer a dead retry for refused quiz access (%s)', async (status) => {
    jest.mocked(getCourseQuiz).mockRejectedValueOnce(new ApiResponseError(status, 'This quiz is unavailable.'));
    const screen = render(<LessonQuiz quizId={44} />);
    await screen.findByText('This quiz is unavailable.');
    expect(screen.queryByText('common:buttons.retry')).toBeNull();
    expect(screen.queryByTestId('quiz-submit')).toBeNull();
  });

  it('keeps submitted answers unchanged while saving and preserves them after failure', async () => {
    let fail!: (reason: Error) => void;
    jest.mocked(submitCourseQuizAttempt).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    const screen = render(<LessonQuiz quizId={44} />);
    await screen.findByText('An hour of help');
    fireEvent.press(screen.getByText('An hour of help'));
    fireEvent.press(screen.getByText('Events'));
    fireEvent.changeText(screen.getByLabelText('Describe one exchange.'), 'Original answer');
    fireEvent.press(screen.getByTestId('quiz-submit'));
    expect(screen.getByLabelText('Describe one exchange.').props.editable).toBe(false);
    fireEvent.press(screen.getByText('A discount'));
    fireEvent.changeText(screen.getByLabelText('Describe one exchange.'), 'Changed answer');
    await waitFor(() => expect(submitCourseQuizAttempt).toHaveBeenCalledTimes(1));
    await act(async () => { fail(new ApiResponseError(422, 'Please review your answer')); });
    expect(screen.getByLabelText('Describe one exchange.').props.value).toBe('Original answer');
    expect(screen.getByLabelText('Describe one exchange.').props.editable).toBe(true);
    fireEvent.press(screen.getByTestId('quiz-submit'));
    await waitFor(() => expect(submitCourseQuizAttempt).toHaveBeenLastCalledWith(44, { '1': 'a', '2': ['x'], '3': 'Original answer' }, expect.any(String)));
  });

  it('offers a retry when the quiz itself could not be loaded', async () => {
    jest.mocked(getCourseQuiz).mockRejectedValueOnce(new ApiResponseError(429, 'Please try later.'));

    const { getByText } = render(<LessonQuiz quizId={44} />);

    await waitFor(() => expect(getByText('Please try later.')).toBeTruthy());
    fireEvent.press(getByText('common:buttons.retry'));
    await waitFor(() => expect(jest.mocked(getCourseQuiz).mock.calls.length).toBeGreaterThan(1));
  });

  // ─── An attempt is a limited resource ──────────────────────────────────────
  //
  // 🔴 Submit used to send whatever was in the answer map, including nothing at
  // all. One stray tap scored 0% and spent one of (often) three tries, with no
  // way to get it back. Audit 2026-09-07, still open until 2026-09-08.

  it('refuses to spend an attempt on a quiz with nothing answered', async () => {
    const { getByTestId, getByText } = render(<LessonQuiz quizId={44} />);
    await waitFor(() => expect(getByText('quiz.submit')).toBeTruthy());

    await act(async () => { fireEvent.press(getByTestId('quiz-submit')); });

    expect(submitCourseQuizAttempt).not.toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
    // …and says why, rather than leaving a dead button with no explanation.
    expect(getByTestId('quiz-nothing-answered')).toHaveTextContent('quiz.nothing_answered');
  });

  it('does not count whitespace or an emptied multi-choice as an answer', async () => {
    const { getByLabelText, getByTestId, getByText } = render(<LessonQuiz quizId={44} />);
    await waitFor(() => expect(getByText('Events')).toBeTruthy());

    // Tick then untick: the answer map now holds [], which is not an answer.
    fireEvent.press(getByText('Events'));
    fireEvent.press(getByText('Events'));
    fireEvent.changeText(getByLabelText('Describe one exchange.'), '   ');

    await act(async () => { fireEvent.press(getByTestId('quiz-submit')); });

    expect(submitCourseQuizAttempt).not.toHaveBeenCalled();
    expect(getByTestId('quiz-nothing-answered')).toBeTruthy();
  });

  it('asks before spending an attempt on a partly answered quiz, and says what it costs', async () => {
    jest.mocked(getCourseQuiz).mockResolvedValue({ ...QUIZ, max_attempts: 3 } as never);

    const { getByTestId, getByText } = render(<LessonQuiz quizId={44} />);
    await waitFor(() => expect(getByText('An hour of help')).toBeTruthy());

    fireEvent.press(getByText('An hour of help'));
    await act(async () => { fireEvent.press(getByTestId('quiz-submit')); });

    // Asked, not sent.
    expect(submitCourseQuizAttempt).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'quiz.incomplete_title',
      message: 'quiz.incomplete_message_attempts',
    }));

    // Saying yes sends it.
    await act(async () => { await mockConfirm.mock.calls[0][0].onConfirm(); });
    expect(submitCourseQuizAttempt).toHaveBeenCalledWith(44, { '1': 'a' }, expect.any(String));
  });

  it('leaves the attempt unspent when the learner backs out', async () => {
    const { getByTestId, getByText } = render(<LessonQuiz quizId={44} />);
    await waitFor(() => expect(getByText('An hour of help')).toBeTruthy());

    fireEvent.press(getByText('An hour of help'));
    await act(async () => { fireEvent.press(getByTestId('quiz-submit')); });

    expect(mockConfirm).toHaveBeenCalled();
    // The learner never confirms — nothing must reach the server.
    expect(submitCourseQuizAttempt).not.toHaveBeenCalled();
  });

  it('explains oversized answers, keeps them editable and sends only after correction', async () => {
    const { getByLabelText, getByText, getByTestId, queryByTestId } = render(<LessonQuiz quizId={44} />);
    await waitFor(() => expect(getByText('An hour of help')).toBeTruthy());
    fireEvent.press(getByText('An hour of help'));
    fireEvent.press(getByText('Events'));
    const longAnswer = 'x'.repeat(11200);
    fireEvent.changeText(getByLabelText('Describe one exchange.'), longAnswer);
    fireEvent.press(getByTestId('quiz-submit'));
    await waitFor(() => expect(getByText('quiz.answers_too_long')).toBeTruthy());
    expect(submitCourseQuizAttempt).not.toHaveBeenCalled();
    expect(queryByTestId('quiz-pending')).toBeNull();
    expect(getByLabelText('Describe one exchange.').props.value).toBe(longAnswer);
    expect(getByLabelText('Describe one exchange.').props.editable).toBe(true);
    fireEvent.changeText(getByLabelText('Describe one exchange.'), 'A repair.');
    fireEvent.press(getByTestId('quiz-submit'));
    await waitFor(() => expect(getByTestId('quiz-result')).toBeTruthy());
    await waitFor(() => expect(queryByTestId('quiz-pending')).toBeNull());
    expect(submitCourseQuizAttempt).toHaveBeenCalledTimes(1);
  });

  it('does not interrupt a learner who answered everything', async () => {
    const { getByLabelText, getByText } = render(<LessonQuiz quizId={44} />);
    await waitFor(() => expect(getByText('An hour of help')).toBeTruthy());

    fireEvent.press(getByText('An hour of help'));
    fireEvent.press(getByText('Events'));
    fireEvent.changeText(getByLabelText('Describe one exchange.'), 'A repair.');

    await act(async () => { fireEvent.press(getByText('quiz.submit')); });

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(submitCourseQuizAttempt).toHaveBeenCalled();
  });
});
