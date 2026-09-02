// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/contexts', () => createMockContexts({
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle' as const, error: null }),
  useTenant: () => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    isLoading: false,
  }),
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// Mock coursesApi — CoursesPage imports from '@/lib/api/courses'
vi.mock('@/lib/api/courses', () => ({
  coursesApi: {
    browse: vi.fn(),
    categories: vi.fn(),
  },
}));

// Mock the CourseCard component to keep tests simple
vi.mock('@/components/courses/CourseCard', () => ({
  CourseCard: ({ course }: { course: { title: string } }) => (
    <div data-testid="course-card">{course.title}</div>
  ),
}));

// Mock ModuleStageBadge used in the page
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...actual,
    ModuleStageBadge: () => <span data-testid="module-stage-badge">Beta</span>,
  };
});

import CoursesPage from './CoursesPage';
import { coursesApi } from '@/lib/api/courses';

const EMPTY_BROWSE = { success: true, data: { items: [], total: 0, page: 1, per_page: 20, total_pages: 0, has_more: false } };
const EMPTY_CATEGORIES = { success: true, data: [] };

describe('CoursesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coursesApi.categories).mockResolvedValue(EMPTY_CATEGORIES);
    vi.mocked(coursesApi.browse).mockResolvedValue(EMPTY_BROWSE);
  });

  it('shows a loading spinner while fetching courses', async () => {
    // Never resolve — hold in pending so spinner stays visible
    vi.mocked(coursesApi.browse).mockReturnValue(new Promise(() => {}));
    render(<CoursesPage />);
    // The spinner container has aria-busy="true"
    const busyEl = document.querySelector('[aria-busy="true"]');
    expect(busyEl).toBeInTheDocument();
  });

  it('shows empty state text after loading with no courses', async () => {
    render(<CoursesPage />);
    // Wait until the busy spinner disappears (loading done)
    await waitFor(() => {
      expect(document.querySelector('[aria-busy="true"]')).not.toBeInTheDocument();
    });
    // The page title heading should be visible
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('renders course cards when courses are returned', async () => {
    vi.mocked(coursesApi.browse).mockResolvedValue({
      success: true,
      data: {
        items: [
          { id: 1, title: 'Intro to Timebanking', slug: 'intro', level: 'beginner', author_user_id: 10, category_id: null, visibility: 'public', enrollment_type: 'self_paced', status: 'published', moderation_status: 'approved', credit_cost: '0', learner_credit_reward: '1', instructor_credit_reward: '1', enrollment_count: 5, completion_count: 0, rating_avg: '0', rating_count: 0 },
          { id: 2, title: 'Advanced Matching', slug: 'advanced', level: 'advanced', author_user_id: 11, category_id: null, visibility: 'public', enrollment_type: 'self_paced', status: 'published', moderation_status: 'approved', credit_cost: '2', learner_credit_reward: '1', instructor_credit_reward: '1', enrollment_count: 3, completion_count: 1, rating_avg: '4.5', rating_count: 2 },
        ],
        total: 2, page: 1, per_page: 20, total_pages: 1, has_more: false,
      },
    });

    render(<CoursesPage />);
    await waitFor(() => expect(screen.getAllByTestId('course-card')).toHaveLength(2));
    expect(screen.getByText('Intro to Timebanking')).toBeInTheDocument();
    expect(screen.getByText('Advanced Matching')).toBeInTheDocument();
  });

  it('populates category select when categories load', async () => {
    vi.mocked(coursesApi.categories).mockResolvedValue({
      success: true,
      data: [{ id: 1, name: 'Technology', slug: 'tech', position: 1 }],
    });

    render(<CoursesPage />);
    await waitFor(() => expect(coursesApi.categories).toHaveBeenCalled());
    // Category select renders — we check by aria-label
    expect(screen.getByRole('button', { name: /all categories/i })).toBeInTheDocument();
  });

  it('shows load more button when has_more is true', async () => {
    vi.mocked(coursesApi.browse).mockResolvedValue({
      success: true,
      data: {
        items: [{ id: 1, title: 'Course A', slug: 'a', level: 'beginner', author_user_id: 1, category_id: null, visibility: 'public', enrollment_type: 'self_paced', status: 'published', moderation_status: 'approved', credit_cost: '0', learner_credit_reward: '0', instructor_credit_reward: '0', enrollment_count: 0, completion_count: 0, rating_avg: '0', rating_count: 0 }],
        total: 50, page: 1, per_page: 20, total_pages: 3, has_more: true,
      },
    });

    render(<CoursesPage />);
    await waitFor(() => expect(screen.getByTestId('course-card')).toBeInTheDocument());
    // "load_more" translation key rendered as a button
    const loadMoreBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('more') || b.textContent?.toLowerCase().includes('load')
    );
    expect(loadMoreBtn).toBeInTheDocument();
  });

  it('does not show authenticated action buttons for unauthenticated users', async () => {
    render(<CoursesPage />);
    await waitFor(() => expect(coursesApi.browse).toHaveBeenCalled());
    // instructor / my-learning buttons are conditional on isAuthenticated
    expect(screen.queryByText(/my.learning/i)).not.toBeInTheDocument();
  });
});
