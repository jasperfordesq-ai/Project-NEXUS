// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 🔴 The 2026-09-06 audit's F03. The native player rendered `body` and `transcript` and
 nothing else, so `video`, `pdf`, `embed` and `quiz` lessons — four of the five types the
 schema declares — gave the learner a title and a completion button and no content. These
 assert that each type produces the thing a learner can actually use.
*/

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ text: '#111', textSecondary: '#555', border: '#ddd', error: '#b00' }),
}));
jest.mock('@/components/ui/Icon', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-av', () => ({ ResizeMode: { CONTAIN: 'contain' }, Video: 'Video' }));
jest.mock('@/components/courses/LessonQuiz', () => 'LessonQuiz');

import LessonContent from './LessonContent';
import type { CourseLesson } from '@/lib/api/courses';

function lessonOf(overrides: Partial<CourseLesson>): CourseLesson {
  return {
    id: 12,
    course_id: 7,
    section_id: 2,
    title: 'Your first exchange',
    content_type: 'text',
    position: 1,
    is_preview: false,
    ...overrides,
  } as CourseLesson;
}

describe('LessonContent', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    // 🔴 clearAllMocks as well: `restoreAllMocks` does not reset the recorded call list on
    // these React Native module spies, so the previous test's `openURL` call was still
    // visible to a "was it NOT called?" assertion.
    jest.clearAllMocks();
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
  });

  it('plays a video lesson', () => {
    const { getByTestId } = render(
      <LessonContent lesson={lessonOf({ content_type: 'video', video_url: 'https://cdn.example.org/a.mp4' })} />,
    );
    expect(getByTestId('lesson-video').props.source).toEqual({ uri: 'https://cdn.example.org/a.mp4' });
  });

  it('reports the high-water mark of a video, not the current position', () => {
    // A learner who watches to the end and drags back to re-check something has still
    // watched it. Reporting the scrubbed-to position would quietly undo their progress.
    const onWatchPercentChange = jest.fn();
    const { getByTestId } = render(
      <LessonContent
        lesson={lessonOf({ content_type: 'video', video_url: 'https://cdn.example.org/a.mp4' })}
        onWatchPercentChange={onWatchPercentChange}
      />,
    );

    // Wrapped in `act`: the callback sets state, and an unwrapped update is the kind of
    // warning that becomes an intermittent failure on a slower CI runner.
    const emit = (positionMillis: number) => {
      act(() => {
        getByTestId('lesson-video').props.onPlaybackStatusUpdate({
          isLoaded: true, positionMillis, durationMillis: 100_000,
        });
      });
    };
    emit(80_000);
    emit(10_000);

    expect(onWatchPercentChange).toHaveBeenLastCalledWith(80);
  });

  it('counts a video played to the end as fully watched', () => {
    const onWatchPercentChange = jest.fn();
    const { getByTestId } = render(
      <LessonContent
        lesson={lessonOf({ content_type: 'video', video_url: 'https://cdn.example.org/a.mp4' })}
        onWatchPercentChange={onWatchPercentChange}
      />,
    );

    act(() => {
      getByTestId('lesson-video').props.onPlaybackStatusUpdate({
        isLoaded: true, positionMillis: 99_400, durationMillis: 100_000, didJustFinish: true,
      });
    });

    expect(onWatchPercentChange).toHaveBeenLastCalledWith(100);
  });

  it('hands a PDF lesson to the device viewer', async () => {
    const { getByTestId } = render(
      <LessonContent lesson={lessonOf({ content_type: 'pdf', attachment_url: 'https://cdn.example.org/handbook.pdf' })} />,
    );

    fireEvent.press(getByTestId('lesson-open-external'));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith('https://cdn.example.org/handbook.pdf'));
  });

  it('says so when the device cannot open the content, instead of a tap doing nothing', async () => {
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(false);
    const { getByTestId } = render(
      <LessonContent lesson={lessonOf({ content_type: 'embed', embed_url: 'https://player.example.org/v/1' })} />,
    );

    fireEvent.press(getByTestId('lesson-open-external'));
    await waitFor(() => expect(getByTestId('lesson-open-failed')).toBeTruthy());
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('refuses a non-http scheme rather than handing it to the phone', async () => {
    // These fields are typed by an instructor. On a phone a `file:` URL addresses the
    // device's own storage, so the same rule the web client and the API apply is applied
    // here before anything reaches a player or `Linking.openURL`.
    const { getByTestId, queryByTestId } = render(
      <LessonContent lesson={lessonOf({ content_type: 'pdf', attachment_url: 'file:///etc/passwd' })} />,
    );

    expect(getByTestId('lesson-media-missing')).toBeTruthy();
    expect(queryByTestId('lesson-open-external')).toBeNull();
  });

  it('renders a quiz lesson as a quiz', () => {
    const { UNSAFE_getByType } = render(
      <LessonContent lesson={lessonOf({ content_type: 'quiz', quiz: { id: 44, course_id: 7, lesson_id: 12, title: 'Check' } })} />,
    );
    expect(UNSAFE_getByType('LessonQuiz' as never).props.quizId).toBe(44);
  });

  it('says a lesson has no content yet rather than rendering an empty card', () => {
    const { getByTestId } = render(
      <LessonContent lesson={lessonOf({ content_type: 'video', video_url: null })} />,
    );
    expect(getByTestId('lesson-media-missing')).toBeTruthy();
  });

  it('keeps the transcript available as the text alternative', () => {
    const { getByText, getByTestId } = render(
      <LessonContent
        lesson={lessonOf({ content_type: 'video', video_url: 'https://cdn.example.org/a.mp4', transcript: 'Welcome to the course.' })}
      />,
    );

    fireEvent.press(getByText('player.transcript'));
    expect(getByTestId('lesson-transcript')).toHaveTextContent('Welcome to the course.');
  });
});
