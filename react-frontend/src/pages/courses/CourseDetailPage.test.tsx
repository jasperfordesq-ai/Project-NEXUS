// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useParams: () => ({ idOrSlug: 'intro-to-timebanking' }),
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () => createMockContexts({
  useToast: () => mockToast,
  useAuth: () => ({
    user: { id: 42, name: 'Test User' },
    isAuthenticated: true,
    login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(),
    status: 'idle' as const, error: null,
  }),
  useTenant: () => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    isLoading: false,
  }),
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/lib/api/courses', () => ({
  coursesApi: {
    show: vi.fn(),
    prerequisites: vi.fn(),
    enroll: vi.fn(),
  },
}));

// Stub the CourseReviews sub-component to isolate CourseDetailPage
vi.mock('@/components/courses/CourseReviews', () => ({
  CourseReviews: () => <div data-testid="course-reviews">Reviews</div>,
}));

vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...actual,
    ModuleStageBadge: () => <span data-testid="module-stage-badge">Beta</span>,
  };
});

import CourseDetailPage from './CourseDetailPage';
import { coursesApi } from '@/lib/api/courses';

const MOCK_COURSE = {
  id: 101,
  title: 'Intro to Timebanking',
  slug: 'intro-to-timebanking',
  summary: 'A great intro course',
  description: 'Full description here',
  level: 'beginner' as const,
  author_user_id: 99, // different from auth user (42) → not owner
  category_id: null,
  visibility: 'public' as const,
  enrollment_type: 'self_paced' as const,
  status: 'published' as const,
  moderation_status: 'approved' as const,
  credit_cost: '0',
  learner_credit_reward: '1',
  instructor_credit_reward: '1',
  enrollment_count: 5,
  completion_count: 2,
  rating_avg: '4.2',
  rating_count: 3,
  is_enrolled: false,
  sections: [],
};

describe('CourseDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coursesApi.prerequisites).mockResolvedValue({ success: true, data: [] });
  });

  it('shows a loading spinner while fetching the course', () => {
    vi.mocked(coursesApi.show).mockReturnValue(new Promise(() => {}));
    render(<CourseDetailPage />);
    // The outer div has role="status" and aria-busy="true"
    const statuses = screen.getAllByRole('status');
    expect(statuses.length).toBeGreaterThanOrEqual(1);
    // At least one element carries aria-busy="true"
    const busyEl = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busyEl).toBeInTheDocument();
  });

  it('shows empty text when course is not found', async () => {
    vi.mocked(coursesApi.show).mockResolvedValue({ success: false, data: undefined });
    render(<CourseDetailPage />);
    // Wait for loading to finish (no more aria-busy="true" on the top-level wrapper)
    await waitFor(() => {
      const busy = document.querySelector('[aria-busy="true"]');
      expect(busy).not.toBeInTheDocument();
    });
    // Not-found renders text (browse.empty key) — check no heading present
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('renders course title and summary when loaded', async () => {
    vi.mocked(coursesApi.show).mockResolvedValue({ success: true, data: MOCK_COURSE });
    render(<CourseDetailPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    expect(screen.getByText('Intro to Timebanking')).toBeInTheDocument();
    expect(screen.getByText('A great intro course')).toBeInTheDocument();
  });

  it('shows the enroll button for a non-enrolled, non-owner user', async () => {
    vi.mocked(coursesApi.show).mockResolvedValue({ success: true, data: MOCK_COURSE });
    render(<CourseDetailPage />);
    await waitFor(() => screen.getByRole('heading', { level: 1 }));
    // "enroll" translation key → button
    const enrollBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('enroll') || b.textContent?.toLowerCase().includes('enrol')
    );
    expect(enrollBtn).toBeInTheDocument();
  });

  it('calls enroll API and navigates on success', async () => {
    vi.mocked(coursesApi.show).mockResolvedValue({ success: true, data: MOCK_COURSE });
    vi.mocked(coursesApi.enroll).mockResolvedValue({ success: true, data: { id: 1, course_id: 101, user_id: 42, status: 'active', progress_percent: 0 } });

    render(<CourseDetailPage />);
    await waitFor(() => screen.getByRole('heading', { level: 1 }));

    const enrollBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('enroll') || b.textContent?.toLowerCase().includes('enrol')
    );
    fireEvent.click(enrollBtn!);

    await waitFor(() => {
      expect(coursesApi.enroll).toHaveBeenCalledWith(101);
      expect(mockNavigate).toHaveBeenCalledWith('/test/courses/101/learn');
    });
  });

  it('shows an error toast when enrollment fails with INSUFFICIENT_CREDITS', async () => {
    vi.mocked(coursesApi.show).mockResolvedValue({ success: true, data: MOCK_COURSE });
    vi.mocked(coursesApi.enroll).mockResolvedValue({ success: false, code: 'INSUFFICIENT_CREDITS' });

    render(<CourseDetailPage />);
    await waitFor(() => screen.getByRole('heading', { level: 1 }));

    const enrollBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('enroll') || b.textContent?.toLowerCase().includes('enrol')
    );
    fireEvent.click(enrollBtn!);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows continue button when already enrolled', async () => {
    vi.mocked(coursesApi.show).mockResolvedValue({
      success: true,
      data: { ...MOCK_COURSE, is_enrolled: true },
    });
    render(<CourseDetailPage />);
    await waitFor(() => screen.getByRole('heading', { level: 1 }));
    const continueBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('continue')
    );
    expect(continueBtn).toBeInTheDocument();
  });

  it('shows edit button when user is the course owner', async () => {
    vi.mocked(coursesApi.show).mockResolvedValue({
      success: true,
      data: { ...MOCK_COURSE, author_user_id: 42 }, // matches auth user id
    });
    render(<CourseDetailPage />);
    await waitFor(() => screen.getByRole('heading', { level: 1 }));
    const editBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('edit')
    );
    expect(editBtn).toBeInTheDocument();
  });

  it('renders prerequisites when present', async () => {
    vi.mocked(coursesApi.show).mockResolvedValue({ success: true, data: MOCK_COURSE });
    vi.mocked(coursesApi.prerequisites).mockResolvedValue({
      success: true,
      data: [{ id: 5, title: 'Foundations', slug: 'foundations', completed: false }],
    });
    render(<CourseDetailPage />);
    await waitFor(() => screen.getByRole('heading', { level: 1 }));
    await waitFor(() => expect(screen.getByText('Foundations')).toBeInTheDocument());
  });

  it('disables enroll button when prerequisites are not met', async () => {
    vi.mocked(coursesApi.show).mockResolvedValue({ success: true, data: MOCK_COURSE });
    vi.mocked(coursesApi.prerequisites).mockResolvedValue({
      success: true,
      data: [{ id: 5, title: 'Foundations', slug: 'foundations', completed: false }],
    });
    render(<CourseDetailPage />);
    await waitFor(() => screen.getByRole('heading', { level: 1 }));
    await waitFor(() => expect(screen.getByText('Foundations')).toBeInTheDocument());

    const enrollBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('enroll') || b.textContent?.toLowerCase().includes('enrol')
    );
    // HeroUI disables buttons via aria-disabled or data-disabled attribute
    const isDisabled =
      enrollBtn?.getAttribute('aria-disabled') === 'true' ||
      enrollBtn?.getAttribute('data-disabled') === 'true' ||
      enrollBtn?.hasAttribute('disabled');
    expect(isDisabled).toBe(true);
  });
});
