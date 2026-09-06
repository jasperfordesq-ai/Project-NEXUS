// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Renders whatever a lesson actually IS — all five of the content types the schema
 * declares, not just the one the native player happened to handle.
 *
 * 🔴 Before this, the native player rendered `body` and `transcript` and nothing else. A
 * `video`, `pdf`, `embed` or `quiz` lesson with no text body gave the learner its title and
 * a "Mark as complete" button and no content whatsoever — four of the five types, on a
 * paid module. The web player has rendered all five since it shipped
 * (`react-frontend/src/pages/courses/CoursePlayerPage.tsx`), so this is the app catching up
 * to a contract that already existed, not new product design.
 *
 * 🔴 What is deliberately NOT inline, and why. `pdf` and `embed` open in the phone's own
 * viewer/browser rather than in an in-app web view. React Native has no built-in web view
 * and `react-native-webview` is a **native** module: adding one means a new Play/App Store
 * build, so no member could receive this fix over the air. Handing a document to the system
 * viewer is also the better experience — real PDF paging, search, zoom, save and print,
 * none of which an iframe substitute would give. An `embed_url` is third-party media
 * (YouTube, Vimeo) by definition, so opening it externally is not the app pushing members
 * back to our own website; it is the established `Linking.openURL` case, alongside
 * attachments and meeting links.
 *
 * Every URL passes `normalizeCourseMediaUrl` first. These fields are typed by an
 * instructor, and on a phone a `file:` URL addresses the device's own storage.
 */

import { useCallback, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { ResizeMode, Video, type AVPlaybackStatus } from 'expo-av';
import { Button as HeroButton } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import LessonQuiz from '@/components/courses/LessonQuiz';
import { Ionicons } from '@/components/ui/Icon';
import type { CourseLesson } from '@/lib/api/courses';
import { useTheme } from '@/lib/hooks/useTheme';
import { courseMediaFileName, normalizeCourseMediaUrl } from '@/lib/utils/courseMediaUrl';

export interface LessonContentProps {
  lesson: CourseLesson;
  /**
   * Reports how much of a video lesson has actually been played, 0-100.
   *
   * The player passes this to the completion call instead of the flat 100 it used to send
   * for every lesson regardless of whether anything was watched. A lesson type with no
   * playback never calls this, and the player keeps its 100 — a text lesson genuinely has
   * no watch metric.
   */
  onWatchPercentChange?: (percent: number) => void;
}

/** A video or embedded lesson needs a text alternative (WCAG 1.2.x). */
function LessonTranscript({ transcript }: { transcript?: string | null }) {
  const { t } = useTranslation('courses');
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const text = transcript?.trim();
  if (!text) return null;

  return (
    <View className="gap-2">
      <HeroButton
        variant="tertiary"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
      >
        <HeroButton.Label>{t('player.transcript')}</HeroButton.Label>
      </HeroButton>
      {open ? (
        <Text testID="lesson-transcript" className="leading-6" style={{ color: theme.textSecondary }}>
          {text}
        </Text>
      ) : null}
    </View>
  );
}

/** Nothing usable was supplied for this lesson type. Say so; do not render an empty card. */
function MissingMedia({ message }: { message: string }) {
  const theme = useTheme();
  return (
    <Text testID="lesson-media-missing" style={{ color: theme.textSecondary }}>{message}</Text>
  );
}

/**
 * Hands a document or embedded page to whatever app the phone uses for it.
 *
 * `canOpenURL` is checked so a device with nothing registered for the scheme reports that
 * honestly rather than a tap doing nothing at all — the failure mode that makes a learner
 * conclude the lesson is broken.
 */
function ExternalContent({
  url,
  icon,
  label,
  hint,
  unavailableMessage,
}: {
  url: string;
  icon: 'document-text-outline' | 'globe-outline';
  label: string;
  hint: string;
  unavailableMessage: string;
}) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const fileName = courseMediaFileName(url);

  const open = useCallback(async () => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        setFailed(true);
        return;
      }
      await Linking.openURL(url);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [url]);

  return (
    <View className="gap-2">
      <HeroButton testID="lesson-open-external" onPress={() => void open()}>
        <HeroButton.Label>{label}</HeroButton.Label>
      </HeroButton>
      <View className="flex-row items-center gap-2">
        <Ionicons name={icon} size={16} color={theme.textSecondary} />
        <Text className="flex-1 text-xs leading-5" style={{ color: theme.textSecondary }}>
          {fileName ? `${fileName} · ${hint}` : hint}
        </Text>
      </View>
      {failed ? (
        <Text testID="lesson-open-failed" style={{ color: theme.error }}>{unavailableMessage}</Text>
      ) : null}
    </View>
  );
}

export default function LessonContent({ lesson, onWatchPercentChange }: LessonContentProps) {
  const { t } = useTranslation('courses');
  const theme = useTheme();

  /**
   * Watch progress is the HIGH-WATER MARK, not the current position. A learner who watches
   * to the end and then drags back to re-check something has still watched it; reporting
   * the scrubbed-to position would quietly undo their progress.
   */
  const [watched, setWatched] = useState(0);

  const onPlaybackStatus = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded || !status.durationMillis) return;
    const percent = Math.min(100, (status.positionMillis / status.durationMillis) * 100);
    setWatched((current) => {
      const next = Math.max(current, percent);
      if (next > current) onWatchPercentChange?.(next);
      return next;
    });
    // A video played to its end counts as fully watched even if the last tick lands short.
    if (status.didJustFinish) {
      setWatched(100);
      onWatchPercentChange?.(100);
    }
  }, [onWatchPercentChange]);

  switch (lesson.content_type) {
    case 'video': {
      const videoUrl = normalizeCourseMediaUrl(lesson.video_url);
      if (!videoUrl) return <MissingMedia message={t('player.video_unavailable')} />;
      return (
        <View className="gap-3">
          <Video
            testID="lesson-video"
            accessibilityLabel={lesson.title}
            onPlaybackStatusUpdate={onPlaybackStatus}
            resizeMode={ResizeMode.CONTAIN}
            source={{ uri: videoUrl }}
            style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 10, backgroundColor: '#000' }}
            useNativeControls
          />
          <Text className="text-xs" style={{ color: theme.textSecondary }}>
            {t('player.watched', { percent: Math.round(watched) })}
          </Text>
          <LessonTranscript transcript={lesson.transcript} />
        </View>
      );
    }

    case 'pdf': {
      const attachmentUrl = normalizeCourseMediaUrl(lesson.attachment_url);
      if (!attachmentUrl) return <MissingMedia message={t('player.document_unavailable')} />;
      return (
        <View className="gap-3">
          <ExternalContent
            url={attachmentUrl}
            icon="document-text-outline"
            label={t('player.open_document')}
            hint={t('player.open_document_hint')}
            unavailableMessage={t('player.open_failed')}
          />
          {lesson.body ? (
            <Text className="text-base leading-7" style={{ color: theme.text }}>{lesson.body}</Text>
          ) : null}
          <LessonTranscript transcript={lesson.transcript} />
        </View>
      );
    }

    case 'embed': {
      const embedUrl = normalizeCourseMediaUrl(lesson.embed_url);
      if (!embedUrl) return <MissingMedia message={t('player.embed_unavailable')} />;
      return (
        <View className="gap-3">
          <ExternalContent
            url={embedUrl}
            icon="globe-outline"
            label={t('player.open_embed')}
            hint={t('player.open_embed_hint')}
            unavailableMessage={t('player.open_failed')}
          />
          {lesson.body ? (
            <Text className="text-base leading-7" style={{ color: theme.text }}>{lesson.body}</Text>
          ) : null}
          <LessonTranscript transcript={lesson.transcript} />
        </View>
      );
    }

    case 'quiz': {
      // A quiz lesson whose quiz has never been created is an authoring gap, not an error.
      if (!lesson.quiz?.id) return <MissingMedia message={t('quiz.unavailable')} />;
      return <LessonQuiz quizId={lesson.quiz.id} />;
    }

    case 'text':
    default:
      return (
        <View className="gap-3">
          {lesson.body ? (
            <Text className="text-base leading-7" style={{ color: theme.text }}>{lesson.body}</Text>
          ) : (
            <MissingMedia message={t('player.text_unavailable')} />
          )}
          <LessonTranscript transcript={lesson.transcript} />
        </View>
      );
  }
}
