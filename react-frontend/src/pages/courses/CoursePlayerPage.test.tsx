// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── Hoisted mock refs ────────────────────────────────────────────────────────

const { mockUseParams, mockUseNavigate, mockCoursesApi } = vi.hoisted(() => ({
  mockUseParams: vi.fn(() => ({ id: '42' })),
  mockUseNavigate: vi.fn(() => vi.fn()),
  mockCoursesApi: {
    show: vi.fn(),
    progress: vi.fn(),
    completeLesson: vi.fn(),
    getQuiz: vi.fn(),
    submitQuiz: vi.fn(),
  },
}));

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useParams: mockUseParams, useNavigate: mockUseNavigate };
});

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast })
);

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/components/courses/LessonDiscussion', () => ({
  LessonDiscussion: () => <div data-testid="lesson-discussion" />,
}));

vi.mock('@/lib/courseContentSecurity', () => ({
  normalizeCourseMediaUrl: (url: string | null | undefined) => url ?? null,
}));

vi.mock('@/lib/api/courses', () => ({
  coursesApi: mockCoursesApi,
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const lesson1 = {
  id: 1,
  course_id: 42,
  section_id: 1,
  title: 'Introduction',
  content_type: 'text' as const,
  body: 'Welcome to the course.',
  video_url: null,
  attachment_url: null,
  embed_url: null,
  position: 1,
  min_watch_percent: 0,
  is_preview: false,
  quiz: null,
};

const lesson2 = {
  ...lesson1,
  id: 2,
  title: 'Deep Dive',
  body: 'This lesson goes deeper.',
};

const mockCourse = {
  id: 42,
  title: 'Test Course',
  slug: 'test-course',
  sections: [
    { id: 1, course_id: 42, title: 'Section One', position: 1, lessons: [lesson1, lesson2] },
  ],
};

const baseProgress = {
  enrollment: { id: 1, course_id: 42, progress_percent: 25 },
  lessons: [],
  availability: [],
};

// ── Import after mocks ────────────────────────────────────────────────────────

import CoursePlayerPage from './CoursePlayerPage';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CoursePlayerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseParams.mockReturnValue({ id: '42' });
    mockUseNavigate.mockReturnValue(vi.fn());
    mockCoursesApi.show.mockResolvedValue({ success: true, data: mockCourse });
    mockCoursesApi.progress.mockResolvedValue({ success: true, data: baseProgress });
  });

  it('shows loading spinner while fetching', () => {
    mockCoursesApi.show.mockReturnValue(new Promise(() => {}));
    mockCoursesApi.progress.mockReturnValue(new Promise(() => {}));

    render(<CoursePlayerPage />);

    const busyEl = screen
      .getAllByRole('status')
      .find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busyEl).toBeTruthy();
  });

  it('renders lesson list after loading', async () => {
    render(<CoursePlayerPage />);

    await waitFor(() => {
      expect(screen.getByText('Introduction')).toBeInTheDocument();
      expect(screen.getByText('Deep Dive')).toBeInTheDocument();
    });
  });

  it('auto-selects first lesson and shows its body', async () => {
    render(<CoursePlayerPage />);

    await waitFor(() => {
      expect(screen.getByText('Welcome to the course.')).toBeInTheDocument();
    });
  });

  it('switches to a different lesson on click', async () => {
    const user = userEvent.setup();
    render(<CoursePlayerPage />);

    await waitFor(() => {
      expect(screen.getByText('Deep Dive')).toBeInTheDocument();
    });

    const deepDiveBtn = screen.getByRole('button', { name: /Deep Dive/i });
    await user.click(deepDiveBtn);

    await waitFor(() => {
      expect(screen.getByText('This lesson goes deeper.')).toBeInTheDocument();
    });
  });

  it('shows empty text (browse.empty) when course is not found', async () => {
    mockCoursesApi.show.mockResolvedValueOnce({ success: false, data: null });
    mockCoursesApi.progress.mockResolvedValueOnce({ success: true, data: baseProgress });

    render(<CoursePlayerPage />);

    // After loading finishes the empty state div renders
    await waitFor(() => {
      const busyEl = screen
        .queryAllByRole('status')
        .find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busyEl).toBeUndefined();
    });

    // The component renders t('browse.empty') — in real i18n this is an english string
    // We check that the loading spinner is gone and no course title is shown
    expect(screen.queryByText('Test Course')).toBeNull();
  });

  it('shows progress percentage', async () => {
    mockCoursesApi.progress.mockResolvedValueOnce({
      success: true,
      data: {
        ...baseProgress,
        enrollment: { id: 1, course_id: 42, progress_percent: 50 },
      },
    });

    render(<CoursePlayerPage />);

    await waitFor(() => {
      expect(screen.getByText('50%')).toBeInTheDocument();
    });
  });

  it('renders a Mark Complete button for an incomplete lesson', async () => {
    render(<CoursePlayerPage />);

    // Wait for lesson content to load, then verify Mark Complete button appears
    await waitFor(() => {
      expect(screen.getByText('Welcome to the course.')).toBeInTheDocument();
    });

    // player.mark_complete = "Mark as complete" in English
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mark as complete/i })).toBeInTheDocument();
    });
  });

  it('calls completeLesson API when Mark Complete is clicked', async () => {
    const user = userEvent.setup();
    mockCoursesApi.completeLesson.mockResolvedValueOnce({
      success: true,
      data: { progress_percent: 50, course_completed: false },
    });

    render(<CoursePlayerPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mark as complete/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Mark as complete/i }));

    await waitFor(() => {
      expect(mockCoursesApi.completeLesson).toHaveBeenCalledWith(42, 1);
    });
  });

  it('shows lesson_completed toast on success', async () => {
    const user = userEvent.setup();
    mockCoursesApi.completeLesson.mockResolvedValueOnce({
      success: true,
      data: { progress_percent: 50, course_completed: false },
    });

    render(<CoursePlayerPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mark as complete/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Mark as complete/i }));

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows error toast when completeLesson fails', async () => {
    const user = userEvent.setup();
    mockCoursesApi.completeLesson.mockResolvedValueOnce({ success: false });

    render(<CoursePlayerPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mark as complete/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Mark as complete/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('renders a Back to Course button', async () => {
    render(<CoursePlayerPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Back to course/i })).toBeInTheDocument();
    });
  });

  it('shows locked lesson message when lesson is unavailable', async () => {
    mockCoursesApi.progress.mockResolvedValueOnce({
      success: true,
      data: {
        ...baseProgress,
        availability: [{ lesson_id: 1, available: false, unlock_at: null }],
      },
    });

    render(<CoursePlayerPage />);

    // After loading, the Lock icon region should appear (aria-hidden)
    await waitFor(() => {
      expect(screen.getByText('Introduction')).toBeInTheDocument();
    });

    // The active lesson shows locked state — no Mark Complete button
    const markBtn = screen
      .queryAllByRole('button')
      .find((b) => b.textContent?.toLowerCase().includes('mark'));
    // If locked there should be no mark-complete button for lesson 1
    expect(markBtn).toBeUndefined();
  });
/**
   * A video lesson had no text alternative and nowhere to store one (WCAG 1.2).
   * There is still no captions file in the schema, so the instructor's
   * transcript is what a learner who cannot hear or watch the video has.
   */
  it('offers the transcript of a video lesson, and nothing when there is none', async () => {
    const videoLesson = {
      ...lesson1,
      content_type: 'video' as const,
      video_url: 'https://example.org/intro.mp4',
      transcript: 'Hello and welcome to the course.',
    };
    mockCoursesApi.show.mockResolvedValue({
      success: true,
      data: {
        ...mockCourse,
        sections: [{ id: 1, course_id: 42, title: 'Section One', position: 1, lessons: [videoLesson] }],
      },
    });

    render(<CoursePlayerPage />);

    await waitFor(() => {
      expect(screen.getByText('Hello and welcome to the course.')).toBeInTheDocument();
    });

    // A video lesson without a transcript must not render an empty disclosure.
    mockCoursesApi.show.mockResolvedValue({
      success: true,
      data: {
        ...mockCourse,
        sections: [{
          id: 1, course_id: 42, title: 'Section One', position: 1,
          lessons: [{ ...videoLesson, transcript: null }],
        }],
      },
    });
    const { container } = render(<CoursePlayerPage />);
    await waitFor(() => {
      expect(container.querySelector('video')).toBeTruthy();
    });
    expect(container.querySelector('details')).toBeNull();
  });
});
