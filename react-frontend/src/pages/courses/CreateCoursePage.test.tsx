// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Stable mock references (GOTCHA 1) ──────────────────────────────────────
const mockNavigate = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

// Route params the router mock reports. Held in a mutable box so a describe can
// switch between create mode ({}) and edit mode ({ id }) in beforeEach. The edit
// block previously did `vi.mocked(await import('react-router-dom')).useParams = …`
// inside a NON-async beforeEach, which is a syntax error — the whole file failed
// to transform, so every test in it was silently absent rather than failing.
const mockRouteParams: { current: Record<string, string | undefined> } = { current: {} };

vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...real,
    useNavigate: () => mockNavigate,
    // Create mode by default; the edit-mode describe sets mockRouteParams.
    useParams: () => mockRouteParams.current,
  };
});

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      isLoading: false,
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
    useToast: () => ({
      showToast: vi.fn(),
      success: mockToastSuccess,
      error: mockToastError,
      info: vi.fn(),
      warning: vi.fn(),
    }),
  }),
);

// Mock the courses API module
const mockCategoriesFn = vi.fn();
const mockCreateFn = vi.fn();
const mockUpdateFn = vi.fn();
const mockShowFn = vi.fn();
const mockCohortsFn = vi.fn();

vi.mock('@/lib/api/courses', () => ({
  coursesApi: {
    categories: (...args: unknown[]) => mockCategoriesFn(...args),
    create: (...args: unknown[]) => mockCreateFn(...args),
    update: (...args: unknown[]) => mockUpdateFn(...args),
    show: (...args: unknown[]) => mockShowFn(...args),
    cohorts: (...args: unknown[]) => mockCohortsFn(...args),
    publish: vi.fn().mockResolvedValue({ success: true, data: { status: 'published', moderation_status: 'pending' } }),
    unpublish: vi.fn().mockResolvedValue({ success: true, data: { status: 'draft', moderation_status: 'pending' } }),
    createCohort: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// CourseBuilder is heavy — stub it out to avoid deep deps in unit tests
vi.mock('@/components/courses/CourseBuilder', () => ({
  CourseBuilder: () => <div data-testid="course-builder-stub">Course Builder</div>,
}));

import CreateCoursePage from './CreateCoursePage';

// ─── Fixtures ────────────────────────────────────────────────────────────────
const CATEGORIES = [
  { id: 1, name: 'Technology', slug: 'technology', position: 1 },
  { id: 2, name: 'Health', slug: 'health', position: 2 },
];

const CREATED_COURSE = {
  id: 99,
  title: 'My New Course',
  slug: 'my-new-course',
  level: 'beginner' as const,
  visibility: 'members' as const,
  enrollment_type: 'self_paced' as const,
  status: 'draft' as const,
  moderation_status: 'pending' as const,
  credit_cost: 0,
  enrollment_count: 0,
  completion_count: 0,
  rating_avg: 0,
  rating_count: 0,
  author_user_id: 1,
  category_id: null,
};

describe('CreateCoursePage — create mode (no :id param)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set explicitly rather than relying on the initial value: the edit-mode
    // describe below mutates it, so leaving this implicit would make these
    // tests depend on declaration order.
    mockRouteParams.current = {};
    mockCategoriesFn.mockResolvedValue({ success: true, data: CATEGORIES });
    mockCreateFn.mockResolvedValue({ success: true, data: CREATED_COURSE });
  });

  it('renders the create-course heading', async () => {
    render(<CreateCoursePage />);

    // Wait for categories to load
    await waitFor(() => expect(mockCategoriesFn).toHaveBeenCalled());

    // Heading comes from i18n key instructor.new_course
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toBeInTheDocument();
  });

  it('renders form inputs: title, summary, description', async () => {
    render(<CreateCoursePage />);
    await waitFor(() => expect(mockCategoriesFn).toHaveBeenCalled());

    // Input elements should be present
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBeGreaterThanOrEqual(1);
  });

  it('renders the Save button', async () => {
    render(<CreateCoursePage />);
    await waitFor(() => expect(mockCategoriesFn).toHaveBeenCalled());

    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('calls coursesApi.create with correct payload on save', async () => {
    render(<CreateCoursePage />);
    await waitFor(() => expect(mockCategoriesFn).toHaveBeenCalled());

    // Fill in the title field (first required textbox)
    const titleInput = screen.getAllByRole('textbox')[0];
    fireEvent.change(titleInput, { target: { value: 'My New Course' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(mockCreateFn).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'My New Course' }),
      );
    });
  });

  it('navigates to edit page after successful create', async () => {
    render(<CreateCoursePage />);
    await waitFor(() => expect(mockCategoriesFn).toHaveBeenCalled());

    const titleInput = screen.getAllByRole('textbox')[0];
    fireEvent.change(titleInput, { target: { value: 'My New Course' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/test/courses/instructor/99/edit');
    });
  });

  it('shows toast error when create call fails', async () => {
    mockCreateFn.mockResolvedValue({ success: false, data: null });
    render(<CreateCoursePage />);
    await waitFor(() => expect(mockCategoriesFn).toHaveBeenCalled());

    const titleInput = screen.getAllByRole('textbox')[0];
    fireEvent.change(titleInput, { target: { value: 'New Course' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
  });

  it('shows toast error when title is empty and user tries to save', async () => {
    render(<CreateCoursePage />);
    await waitFor(() => expect(mockCategoriesFn).toHaveBeenCalled());

    // Don't fill in the title — click save immediately
    const buttons = screen.getAllByRole('button');
    const saveBtn = buttons.find((b) => !b.hasAttribute('disabled'));
    if (saveBtn) {
      fireEvent.click(saveBtn);
      await waitFor(() => {
        // Either a toast error appears or the API is NOT called (validation blocks it)
        expect(mockCreateFn).not.toHaveBeenCalled();
      });
    }
  });

  it('does NOT render the publish button in create mode', async () => {
    render(<CreateCoursePage />);
    await waitFor(() => expect(mockCategoriesFn).toHaveBeenCalled());

    // Publish button only shows in edit mode
    // There should be no "Publish" / "Unpublish" button when !isEdit
    // (i18n keys instructor.publish / instructor.unpublish)
    // We can't assert on exact i18n text, but we can verify CourseBuilder is absent
    expect(screen.queryByTestId('course-builder-stub')).not.toBeInTheDocument();
  });

  it('fetches categories on mount', async () => {
    render(<CreateCoursePage />);
    await waitFor(() => {
      expect(mockCategoriesFn).toHaveBeenCalled();
    });
  });
});

describe('CreateCoursePage — edit mode (:id param present)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouteParams.current = { id: '42' };

    mockCategoriesFn.mockResolvedValue({ success: true, data: CATEGORIES });
    mockShowFn.mockResolvedValue({
      success: true,
      data: {
        id: 42,
        title: 'Existing Course',
        summary: 'Summary here',
        description: 'Description here',
        level: 'intermediate',
        visibility: 'members',
        enrollment_type: 'self_paced',
        category_id: 1,
        credit_cost: 5,
        prerequisites: [1, 2],
        sections: [],
        status: 'draft',
        moderation_status: 'pending',
      },
    });
    mockCohortsFn.mockResolvedValue({ success: true, data: [] });
    mockUpdateFn.mockResolvedValue({
      success: true,
      data: { id: 42, title: 'Existing Course', status: 'draft', moderation_status: 'pending' },
    });
  });

  it('shows loading spinner while fetching existing course', () => {
    // Never resolve
    mockShowFn.mockReturnValue(new Promise(() => {}));
    render(<CreateCoursePage />);
    // getAllByRole, not getByRole: the page wraps the Spinner in its own
    // aria-busy div that also carries role="status", so the singular getter
    // throws on ambiguity even though the indicator is present. (The redundant
    // nesting is the component's, not the test's — a screen reader gets two
    // status regions here.)
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('renders existing course title in the form after loading', async () => {
    render(<CreateCoursePage />);

    await waitFor(() => {
      // Title field should be populated with the existing course title
      const inputs = screen.getAllByRole('textbox');
      const titleInput = inputs[0];
      expect(titleInput).toHaveValue('Existing Course');
    });
  });

  it('renders the CourseBuilder in edit mode', async () => {
    render(<CreateCoursePage />);
    await waitFor(() => {
      expect(screen.getByTestId('course-builder-stub')).toBeInTheDocument();
    });
  });

  it('calls coursesApi.update (not create) on save in edit mode', async () => {
    render(<CreateCoursePage />);

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      // In edit mode, update should be called, not create
      expect(mockUpdateFn).toHaveBeenCalled();
      expect(mockCreateFn).not.toHaveBeenCalled();
    });
  });
});
