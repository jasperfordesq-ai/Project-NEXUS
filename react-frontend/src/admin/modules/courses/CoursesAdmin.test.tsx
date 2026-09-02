// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── Mock @/lib/api ────────────────────────────────────────────────────────────
const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiDelete = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    put: vi.fn(),
    patch: vi.fn(),
    delete: (...args: unknown[]) => mockApiDelete(...args),
  },
}));

// ── Stable toast ─────────────────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  }),
);

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

// ── Mock admin shell (PageHeader) ────────────────────────────────────────────
// Avoid errors from exotic UI atoms — PageHeader is real enough
vi.mock('../../components', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

// ── Sample data ───────────────────────────────────────────────────────────────
const ANALYTICS = {
  total_courses: 10,
  published_courses: 6,
  pending_moderation: 2,
  total_enrollments: 50,
  completed_enrollments: 20,
  instructors: 3,
};

const COURSES = [
  {
    id: 1,
    title: 'Intro to Timebanking',
    status: 'published',
    moderation_status: 'approved',
    author: { id: 5, name: 'Alice' },
  },
  {
    id: 2,
    title: 'Advanced Community Skills',
    status: 'draft',
    moderation_status: 'pending',
    author: null,
  },
];

const INSTRUCTORS = [
  { id: 1, user_id: 5, user: { id: 5, name: 'Alice' } },
];

function setupSuccessMocks() {
  mockApiGet.mockImplementation((url: string) => {
    if (url.includes('/analytics')) return Promise.resolve({ success: true, data: ANALYTICS });
    if (url.includes('/instructors')) return Promise.resolve({ success: true, data: INSTRUCTORS });
    // /v2/admin/courses
    return Promise.resolve({ success: true, data: COURSES });
  });
}

import CoursesAdmin from './CoursesAdmin';

describe('CoursesAdmin — loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Never resolve to keep loading state
    mockApiGet.mockReturnValue(new Promise(() => {}));
  });

  it('shows loading spinner (aria-busy=true)', () => {
    render(<CoursesAdmin />);
    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeInTheDocument();
  });
});

describe('CoursesAdmin — populated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSuccessMocks();
  });

  it('renders analytics stat values', async () => {
    render(<CoursesAdmin />);
    await waitFor(() => {
      expect(screen.getByText('10')).toBeInTheDocument(); // total_courses
      expect(screen.getByText('6')).toBeInTheDocument();  // published_courses
    });
  });

  it('renders course titles in table', async () => {
    render(<CoursesAdmin />);
    await waitFor(() => {
      expect(screen.getByText('Intro to Timebanking')).toBeInTheDocument();
      expect(screen.getByText('Advanced Community Skills')).toBeInTheDocument();
    });
  });

  it('renders instructor names', async () => {
    render(<CoursesAdmin />);
    await waitFor(() => {
      // Alice appears in both the courses table (author) and the instructors list
      expect(screen.getAllByText('Alice').length).toBeGreaterThan(0);
    });
  });

  it('spinner gone after data loads', async () => {
    render(<CoursesAdmin />);
    await waitFor(() => {
      const busy = screen.queryAllByRole('status').find(
        (el) => el.getAttribute('aria-busy') === 'true',
      );
      expect(busy).toBeUndefined();
    });
  });

  it('calls approve endpoint and reloads on Approve click', async () => {
    mockApiPost.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<CoursesAdmin />);
    await waitFor(() => screen.getByText('Intro to Timebanking'));

    const approveBtns = screen.getAllByRole('button', { name: /approve/i });
    await user.click(approveBtns[0]);

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        expect.stringContaining('/v2/admin/courses/1/moderate'),
        expect.objectContaining({ action: 'approve' }),
      );
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('calls reject endpoint on Reject click', async () => {
    mockApiPost.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<CoursesAdmin />);
    await waitFor(() => screen.getByText('Intro to Timebanking'));

    const rejectBtns = screen.getAllByRole('button', { name: /reject/i });
    await user.click(rejectBtns[0]);

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        expect.stringContaining('/moderate'),
        expect.objectContaining({ action: 'reject' }),
      );
    });
  });

  it('shows error toast when moderate API fails', async () => {
    mockApiPost.mockResolvedValue({ success: false });
    const user = userEvent.setup();
    render(<CoursesAdmin />);
    await waitFor(() => screen.getByText('Intro to Timebanking'));

    const approveBtns = screen.getAllByRole('button', { name: /approve/i });
    await user.click(approveBtns[0]);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('calls grant instructor API and reloads', async () => {
    mockApiPost.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<CoursesAdmin />);
    await waitFor(() => screen.getAllByText('Alice'));

    // HeroUI Input[type=number] renders an actual <input type="number"> in the DOM.
    // Use fireEvent.change rather than userEvent.type to reliably set the value.
    const input = document.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    const { fireEvent: fe } = await import('@testing-library/react');
    fe.change(input, { target: { value: '99' } });

    const grantBtn = screen.getByRole('button', { name: /grant/i });
    await user.click(grantBtn);

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        '/v2/admin/courses/instructors',
        { user_id: 99 },
      );
    });
  });

  it('calls revoke instructor API on Revoke click', async () => {
    mockApiDelete.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<CoursesAdmin />);
    await waitFor(() => screen.getAllByText('Alice'));

    const revokeBtn = screen.getByRole('button', { name: /revoke/i });
    await user.click(revokeBtn);

    await waitFor(() => {
      expect(mockApiDelete).toHaveBeenCalledWith(
        '/v2/admin/courses/instructors/5',
      );
      expect(mockToast.success).toHaveBeenCalled();
    });
  });
});

describe('CoursesAdmin — empty states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/analytics')) return Promise.resolve({ success: true, data: ANALYTICS });
      if (url.includes('/instructors')) return Promise.resolve({ success: true, data: [] });
      return Promise.resolve({ success: true, data: [] });
    });
  });

  it('shows no-courses message when course list is empty', async () => {
    render(<CoursesAdmin />);
    await waitFor(() => {
      // admin.no_courses i18n key
      expect(screen.getByText(/no.+courses/i)).toBeInTheDocument();
    });
  });

  it('shows no-instructors message when instructor list is empty', async () => {
    render(<CoursesAdmin />);
    await waitFor(() => {
      expect(screen.getByText(/no.+instructors/i)).toBeInTheDocument();
    });
  });
});
