// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: '10' }),
  };
});

const mockGradingQueue = vi.fn();
const mockGradeAttempt = vi.fn();

vi.mock('@/lib/api/courses', () => ({
  coursesApi: {
    gradingQueue: (...args: unknown[]) => mockGradingQueue(...args),
    gradeAttempt: (...args: unknown[]) => mockGradeAttempt(...args),
  },
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

import CourseGradingPage from './CourseGradingPage';

const SAMPLE_ATTEMPT = {
  id: 1,
  quiz_id: 5,
  user_id: 99,
  answers: { '1': 'Some essay answer' },
  score_percent: 0,
  grading_status: 'pending',
  submitted_at: '2026-01-01T12:00:00Z',
  quiz: {
    id: 5,
    title: 'Essay Quiz',
    questions: [
      {
        id: 1,
        type: 'essay' as const,
        prompt: 'Describe timebanking in your own words.',
        options: null,
        points: 10,
        position: 1,
      },
    ],
  },
  user: { id: 99, name: 'Bob Learner', avatar_url: null },
};

describe('CourseGradingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows spinner while loading', () => {
    mockGradingQueue.mockReturnValue(new Promise(() => {}));
    render(<CourseGradingPage />);
    // The page renders a div with role="status" aria-busy="true" while loading.
    // The toast provider also injects a role="status" container, so use getAllByRole
    // and look for the one with aria-busy.
    const statusEls = screen.getAllByRole('status');
    const spinnerEl = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(spinnerEl).toBeInTheDocument();
  });

  it('calls gradingQueue with course id from route params', async () => {
    mockGradingQueue.mockResolvedValue({ success: true, data: [] });
    render(<CourseGradingPage />);
    await waitFor(() => {
      expect(mockGradingQueue).toHaveBeenCalledWith(10);
    });
  });

  it('renders empty state when no pending attempts', async () => {
    mockGradingQueue.mockResolvedValue({ success: true, data: [] });
    render(<CourseGradingPage />);
    // 🔴 queryAllByRole, not getAllByRole. This waited for the loading div to
    // disappear on the belief that a ToastProvider status container always
    // remains, so the list could never be empty. It does not — and getAllByRole
    // THROWS on zero matches, so the wait blew up on the query itself the moment
    // loading actually finished, which is exactly the state being waited for.
    await waitFor(() => {
      const loadingEl = screen
        .queryAllByRole('status')
        .find((el) => el.getAttribute('aria-busy') === 'true');
      expect(loadingEl).toBeUndefined();
    });
    // With no attempts there should be no user name cards rendered
    expect(screen.queryByText('Bob Learner')).not.toBeInTheDocument();
  });

  it('renders attempt cards when grading queue has items', async () => {
    mockGradingQueue.mockResolvedValue({ success: true, data: [SAMPLE_ATTEMPT] });
    render(<CourseGradingPage />);
    await waitFor(() => {
      expect(screen.getByText('Bob Learner')).toBeInTheDocument();
    });
    expect(screen.getByText('Essay Quiz')).toBeInTheDocument();
  });

  it('renders the question prompt for pending attempts', async () => {
    mockGradingQueue.mockResolvedValue({ success: true, data: [SAMPLE_ATTEMPT] });
    render(<CourseGradingPage />);
    await waitFor(() => {
      expect(screen.getByText('Describe timebanking in your own words.')).toBeInTheDocument();
    });
  });

  it('renders the learner answer for pending attempts', async () => {
    mockGradingQueue.mockResolvedValue({ success: true, data: [SAMPLE_ATTEMPT] });
    render(<CourseGradingPage />);
    await waitFor(() => {
      expect(screen.getByText('Some essay answer')).toBeInTheDocument();
    });
  });

  it('renders score input field', async () => {
    mockGradingQueue.mockResolvedValue({ success: true, data: [SAMPLE_ATTEMPT] });
    render(<CourseGradingPage />);
    await waitFor(() => {
      // Score input is type=number
      const scoreInput = screen.getByDisplayValue('70');
      expect(scoreInput).toBeInTheDocument();
    });
  });

  it('submits grade when submit button is pressed', async () => {
    mockGradingQueue.mockResolvedValue({ success: true, data: [SAMPLE_ATTEMPT] });
    mockGradeAttempt.mockResolvedValue({ success: true });
    // Second call (after reload) returns empty
    mockGradingQueue.mockResolvedValueOnce({ success: true, data: [SAMPLE_ATTEMPT] })
                    .mockResolvedValue({ success: true, data: [] });

    render(<CourseGradingPage />);

    await waitFor(() => {
      expect(screen.getByText('Bob Learner')).toBeInTheDocument();
    });

    const submitBtn = screen.getByRole('button', { name: /submit/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockGradeAttempt).toHaveBeenCalledWith(
        1,     // attempt id
        70,    // score (default value 70)
        true,  // passed (default)
        '',    // feedback (empty)
      );
    });
  });

  it('shows success toast after successful grade submission', async () => {
    mockGradingQueue.mockResolvedValue({ success: true, data: [SAMPLE_ATTEMPT] });
    mockGradeAttempt.mockResolvedValue({ success: true });

    render(<CourseGradingPage />);
    await waitFor(() => screen.getByText('Bob Learner'));

    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows error toast when grade submission fails', async () => {
    mockGradingQueue.mockResolvedValue({ success: true, data: [SAMPLE_ATTEMPT] });
    mockGradeAttempt.mockResolvedValue({ success: false });

    render(<CourseGradingPage />);
    await waitFor(() => screen.getByText('Bob Learner'));

    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('renders back link to instructor dashboard', async () => {
    mockGradingQueue.mockResolvedValue({ success: true, data: [] });
    render(<CourseGradingPage />);
    // Wait for loading to finish (see the queryAllByRole note above).
    await waitFor(() => {
      const loadingEl = screen
        .queryAllByRole('status')
        .find((el) => el.getAttribute('aria-busy') === 'true');
      expect(loadingEl).toBeUndefined();
    });
    // Button as={Link} renders as an <a> tag; look for it by role="link"
    // pointing to the instructor path
    const links = screen.getAllByRole('link');
    const backLink = links.find((l) => l.getAttribute('href')?.includes('instructor'));
    expect(backLink).toBeInTheDocument();
  });
});
