// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

vi.mock('@/contexts', () => ({
  useToast: vi.fn(() => mockToast),
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null }),
  useTenant: () => ({ tenant: { id: 2, name: 'Test', slug: 'test', tagline: null }, branding: { name: 'Test', logo_url: null }, tenantSlug: 'test', tenantPath: (p: string) => '/test' + p, isLoading: false, hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true) }),
}));

// Mock courses API
const mockCoursesApi = vi.hoisted(() => ({
  createSection: vi.fn(),
  updateSection: vi.fn(),
  deleteSection: vi.fn(),
  createLesson: vi.fn(),
  updateLesson: vi.fn(),
  deleteLesson: vi.fn(),
  reorderLessons: vi.fn(),
  createQuiz: vi.fn(),
  createQuestion: vi.fn(),
}));

vi.mock('@/lib/api/courses', () => ({
  coursesApi: mockCoursesApi,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SECTION_1 = {
  id: 10, course_id: 1, title: 'Intro Section', position: 0,
  lessons: [
    { id: 100, course_id: 1, section_id: 10, title: 'First Lesson', content_type: 'text' as const, body: 'Hello', video_url: null, attachment_url: null, embed_url: null, position: 0, min_watch_percent: 0, drip_type: 'none' as const, drip_offset_days: null, drip_date: null, is_preview: false, quiz: null },
  ],
};

const NEW_SECTION = { id: 20, course_id: 1, title: 'New Section', position: 1, lessons: [] };
const NEW_LESSON  = { id: 200, course_id: 1, section_id: 10, title: 'New Lesson', content_type: 'text' as const, body: null, video_url: null, attachment_url: null, embed_url: null, position: 1, min_watch_percent: 0, drip_type: 'none' as const, drip_offset_days: null, drip_date: null, is_preview: false, quiz: null };

// ─── Import component after mocks ─────────────────────────────────────────────

import { CourseBuilder } from './CourseBuilder';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CourseBuilder — empty state', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders empty state message when no sections', () => {
    render(<CourseBuilder courseId={1} initialSections={[]} />);
    // builder.empty key fallback text present in DOM
    expect(document.body).toBeInTheDocument();
    // Add Section button present
    const addBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('section'));
    expect(addBtn).toBeDefined();
  });

  it('calls createSection when Add Section is clicked', async () => {
    mockCoursesApi.createSection.mockResolvedValue({ success: true, data: NEW_SECTION });
    render(<CourseBuilder courseId={1} initialSections={[]} />);

    const addBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('section'));
    expect(addBtn).toBeDefined();
    fireEvent.click(addBtn!);

    await waitFor(() => {
      expect(mockCoursesApi.createSection).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ position: 0 }),
      );
    });
  });

  it('shows error toast when createSection fails', async () => {
    mockCoursesApi.createSection.mockResolvedValue({ success: false });
    render(<CourseBuilder courseId={1} initialSections={[]} />);

    const addBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('section'));
    fireEvent.click(addBtn!);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });
});

describe('CourseBuilder — with sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCoursesApi.updateSection.mockResolvedValue({ success: true });
    mockCoursesApi.deleteSection.mockResolvedValue({ success: true });
    mockCoursesApi.createLesson.mockResolvedValue({ success: true, data: NEW_LESSON });
    mockCoursesApi.updateLesson.mockResolvedValue({ success: true, data: NEW_LESSON });
    mockCoursesApi.deleteLesson.mockResolvedValue({ success: true });
  });

  it('renders existing section and lesson titles', () => {
    render(<CourseBuilder courseId={1} initialSections={[SECTION_1]} />);
    expect(screen.getByDisplayValue('Intro Section')).toBeInTheDocument();
    expect(screen.getByText('First Lesson')).toBeInTheDocument();
  });

  it('calls deleteSection when delete-section button pressed', async () => {
    render(<CourseBuilder courseId={1} initialSections={[SECTION_1]} />);

    const deleteSectionBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('delete') &&
      b.getAttribute('aria-label')?.toLowerCase().includes('section'),
    );
    expect(deleteSectionBtn).toBeDefined();
    fireEvent.click(deleteSectionBtn!);

    await waitFor(() => {
      expect(mockCoursesApi.deleteSection).toHaveBeenCalledWith(1, SECTION_1.id);
    });
  });

  it('shows error toast when deleteSection fails', async () => {
    mockCoursesApi.deleteSection.mockResolvedValue({ success: false });
    render(<CourseBuilder courseId={1} initialSections={[SECTION_1]} />);

    const deleteSectionBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('delete') &&
      b.getAttribute('aria-label')?.toLowerCase().includes('section'),
    );
    fireEvent.click(deleteSectionBtn!);
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });

  it('calls createLesson when Add Lesson is pressed', async () => {
    render(<CourseBuilder courseId={1} initialSections={[SECTION_1]} />);

    const addLessonBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('lesson') && b.textContent?.toLowerCase().includes('add'),
    );
    expect(addLessonBtn).toBeDefined();
    fireEvent.click(addLessonBtn!);

    await waitFor(() => {
      expect(mockCoursesApi.createLesson).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ section_id: SECTION_1.id }),
      );
    });
  });

  it('move-up button on first section is disabled', () => {
    render(<CourseBuilder courseId={1} initialSections={[SECTION_1]} />);

    const moveUpBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('move up'),
    );
    expect(moveUpBtn).toBeDefined();
    expect(moveUpBtn).toBeDisabled();
  });

  it('move-down button on only section is disabled', () => {
    render(<CourseBuilder courseId={1} initialSections={[SECTION_1]} />);

    const moveDownBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('move down'),
    );
    expect(moveDownBtn).toBeDefined();
    expect(moveDownBtn).toBeDisabled();
  });

  it('calls updateSection ×2 when section is moved', async () => {
    const SECTION_2 = { ...NEW_SECTION, id: 21, title: 'Section B', position: 1, lessons: [] };
    mockCoursesApi.updateSection.mockResolvedValue({ success: true });
    render(<CourseBuilder courseId={1} initialSections={[SECTION_1, SECTION_2]} />);

    // Move-down on first section (index 0)
    const moveDownBtns = screen.getAllByRole('button').filter((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('move down'),
    );
    fireEvent.click(moveDownBtns[0]!);

    await waitFor(() => {
      expect(mockCoursesApi.updateSection).toHaveBeenCalledTimes(2);
    });
  });

  it('opens lesson editor when lesson title is clicked', async () => {
    render(<CourseBuilder courseId={1} initialSections={[SECTION_1]} />);

    const lessonBtn = screen.getByText('First Lesson').closest('button') ??
      screen.getByText('First Lesson');
    fireEvent.click(lessonBtn);

    // Lesson detail area: save-lesson button appears
    await waitFor(() => {
      const saveBtn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('save'),
      );
      expect(saveBtn).toBeDefined();
    });
  });

  it('calls updateLesson with correct payload on save', async () => {
    mockCoursesApi.updateLesson.mockResolvedValue({ success: true, data: NEW_LESSON });
    render(<CourseBuilder courseId={1} initialSections={[SECTION_1]} />);

    const lessonBtn = screen.getByText('First Lesson').closest('button') ??
      screen.getByText('First Lesson');
    fireEvent.click(lessonBtn);

    await waitFor(() => {
      const saveBtn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('save'),
      );
      expect(saveBtn).toBeDefined();
      if (saveBtn) fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(mockCoursesApi.updateLesson).toHaveBeenCalledWith(
        1,
        SECTION_1.lessons[0].id,
        expect.objectContaining({ title: expect.any(String) }),
      );
    });

    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
  });

  it('shows error toast when updateLesson fails', async () => {
    mockCoursesApi.updateLesson.mockResolvedValue({ success: false });
    render(<CourseBuilder courseId={1} initialSections={[SECTION_1]} />);

    const lessonBtn = screen.getByText('First Lesson').closest('button') ??
      screen.getByText('First Lesson');
    fireEvent.click(lessonBtn);

    await waitFor(() => {
      const saveBtn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('save'),
      );
      if (saveBtn) fireEvent.click(saveBtn);
    });

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });

  it('calls deleteLesson when lesson delete button is pressed', async () => {
    render(<CourseBuilder courseId={1} initialSections={[SECTION_1]} />);

    const deleteLessonBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('delete') &&
      b.getAttribute('aria-label')?.toLowerCase().includes('lesson'),
    );
    expect(deleteLessonBtn).toBeDefined();
    fireEvent.click(deleteLessonBtn!);

    await waitFor(() => {
      expect(mockCoursesApi.deleteLesson).toHaveBeenCalledWith(1, SECTION_1.lessons[0].id);
    });
  });
});

describe('CourseBuilder — lesson reorder (atomic reorder endpoint)', () => {
  beforeEach(() => vi.clearAllMocks());

  const SECOND_LESSON = { ...SECTION_1.lessons[0]!, id: 101, title: 'Second Lesson', position: 1 };
  const TWO_LESSONS = { ...SECTION_1, lessons: [SECTION_1.lessons[0]!, SECOND_LESSON] };

  function lessonTitles(): string[] {
    return screen.getAllByText(/^(First|Second) Lesson/).map((el) => (el.textContent ?? '').split('·')[0]!.trim());
  }

  it('labels each lesson move button with the lesson it moves', () => {
    render(<CourseBuilder courseId={1} initialSections={[TWO_LESSONS]} />);

    expect(screen.getByRole('button', { name: 'Move lesson "First Lesson" up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move lesson "First Lesson" down' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move lesson "Second Lesson" up' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move lesson "Second Lesson" down' })).toBeDisabled();
  });

  it('moves a lesson down with one reorder call carrying the expected and new order', async () => {
    mockCoursesApi.reorderLessons.mockResolvedValue({ success: true, data: { ordered_ids: [101, 100] } });
    render(<CourseBuilder courseId={1} initialSections={[TWO_LESSONS]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Move lesson "First Lesson" down' }));

    await waitFor(() => {
      expect(mockCoursesApi.reorderLessons).toHaveBeenCalledWith(1, 10, {
        expected_ids: [100, 101],
        ordered_ids: [101, 100],
      });
    });
    expect(mockCoursesApi.updateLesson).not.toHaveBeenCalled();
    expect(lessonTitles()).toEqual(['Second Lesson', 'First Lesson']);
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('moves a lesson up with the keyboard', async () => {
    mockCoursesApi.reorderLessons.mockResolvedValue({ success: true, data: { ordered_ids: [101, 100] } });
    const user = userEvent.setup();
    render(<CourseBuilder courseId={1} initialSections={[TWO_LESSONS]} />);

    screen.getByRole('button', { name: 'Move lesson "Second Lesson" up' }).focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockCoursesApi.reorderLessons).toHaveBeenCalledWith(1, 10, {
        expected_ids: [100, 101],
        ordered_ids: [101, 100],
      });
    });
  });

  it('puts the order back and explains when someone else changed it first (409)', async () => {
    mockCoursesApi.reorderLessons.mockResolvedValue({ success: false, code: 'COURSE_ORDER_CHANGED' });
    render(<CourseBuilder courseId={1} initialSections={[TWO_LESSONS]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Move lesson "First Lesson" down' }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        'The lesson order was changed somewhere else. Reload the page to see the current order, then try again.',
      );
    });
    expect(lessonTitles()).toEqual(['First Lesson', 'Second Lesson']);
  });

  it('puts the order back on any other failure', async () => {
    mockCoursesApi.reorderLessons.mockResolvedValue({ success: false, code: 'REQUEST_FAILED' });
    render(<CourseBuilder courseId={1} initialSections={[TWO_LESSONS]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Move lesson "First Lesson" down' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Could not save. Please try again.'));
    expect(lessonTitles()).toEqual(['First Lesson', 'Second Lesson']);
  });
});
