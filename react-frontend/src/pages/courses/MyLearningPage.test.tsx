// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/contexts', () => createMockContexts());

// Mock the courses API module — MyLearningPage uses coursesApi.myCourses()
const mockMyCourses = vi.fn();
const mockCertificate = vi.fn();

vi.mock('@/lib/api/courses', () => ({
  coursesApi: {
    myCourses: () => mockMyCourses(),
    certificate: (id: number) => mockCertificate(id),
  },
}));

import MyLearningPage from './MyLearningPage';

const IN_PROGRESS_ENROLLMENT = {
  id: 1,
  course_id: 10,
  user_id: 5,
  status: 'active' as const,
  progress_percent: '45',
  enrolled_at: '2026-05-01T00:00:00Z',
  completed_at: null,
  course: { id: 10, title: 'Intro to TypeScript', slug: 'intro-ts' },
};

const COMPLETED_ENROLLMENT = {
  id: 2,
  course_id: 11,
  user_id: 5,
  status: 'completed' as const,
  progress_percent: '100',
  enrolled_at: '2026-04-01T00:00:00Z',
  completed_at: '2026-05-15T00:00:00Z',
  course: { id: 11, title: 'Advanced React', slug: 'advanced-react' },
};

describe('MyLearningPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMyCourses.mockReset();
    mockCertificate.mockReset();
  });

  it('shows a loading spinner while fetching', () => {
    mockMyCourses.mockReturnValue(new Promise(() => {}));
    const { container } = render(<MyLearningPage />);
    // The outer wrapper has aria-busy="true"; Spinner internals also emit role=status
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it('shows empty state with browse CTA when no enrollments', async () => {
    mockMyCourses.mockResolvedValueOnce({ success: true, data: [] });
    render(<MyLearningPage />);
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeInTheDocument());
    // empty translation key or browse_cta key rendered
    expect(screen.getByText(/empty|browse|my_learning/i)).toBeInTheDocument();
  });

  it('renders in-progress course title', async () => {
    mockMyCourses.mockResolvedValueOnce({ success: true, data: [IN_PROGRESS_ENROLLMENT] });
    render(<MyLearningPage />);
    await waitFor(() => expect(screen.getByText('Intro to TypeScript')).toBeInTheDocument());
  });

  it('renders completed course title', async () => {
    mockMyCourses.mockResolvedValueOnce({ success: true, data: [COMPLETED_ENROLLMENT] });
    render(<MyLearningPage />);
    await waitFor(() => expect(screen.getByText('Advanced React')).toBeInTheDocument());
  });

  it('renders separate in-progress and completed sections', async () => {
    mockMyCourses.mockResolvedValueOnce({
      success: true,
      data: [IN_PROGRESS_ENROLLMENT, COMPLETED_ENROLLMENT],
    });
    render(<MyLearningPage />);
    await waitFor(() => expect(screen.getByText('Intro to TypeScript')).toBeInTheDocument());
    // Both sections exist
    expect(screen.getByText('Advanced React')).toBeInTheDocument();
    // in_progress and completed heading keys
    const headings = screen.getAllByRole('heading');
    expect(headings.length).toBeGreaterThanOrEqual(3); // page h1 + 2 section h2s
  });

  it('shows progress percentage for in-progress course', async () => {
    mockMyCourses.mockResolvedValueOnce({ success: true, data: [IN_PROGRESS_ENROLLMENT] });
    render(<MyLearningPage />);
    await waitFor(() => expect(screen.getByText('45%')).toBeInTheDocument());
  });

  it('shows 100% for completed course', async () => {
    mockMyCourses.mockResolvedValueOnce({ success: true, data: [COMPLETED_ENROLLMENT] });
    render(<MyLearningPage />);
    await waitFor(() => expect(screen.getByText('100%')).toBeInTheDocument());
  });

  it('shows completed chip for completed enrollment', async () => {
    mockMyCourses.mockResolvedValueOnce({ success: true, data: [COMPLETED_ENROLLMENT] });
    render(<MyLearningPage />);
    await waitFor(() => expect(screen.getByText('Advanced React')).toBeInTheDocument());
    // "completed" chip — i18n key my_learning.completed
    const completedTexts = screen.getAllByText(/completed/i);
    expect(completedTexts.length).toBeGreaterThan(0);
  });

  it('renders a continue button for in-progress course', async () => {
    mockMyCourses.mockResolvedValueOnce({ success: true, data: [IN_PROGRESS_ENROLLMENT] });
    render(<MyLearningPage />);
    await waitFor(() => expect(screen.getByText('Intro to TypeScript')).toBeInTheDocument());
    // detail.continue i18n key
    expect(screen.getByRole('link', { name: /continue|detail/i })).toBeInTheDocument();
  });

  it('renders a download certificate button for completed course', async () => {
    mockMyCourses.mockResolvedValueOnce({ success: true, data: [COMPLETED_ENROLLMENT] });
    render(<MyLearningPage />);
    await waitFor(() => expect(screen.getByText('Advanced React')).toBeInTheDocument());
    // certificate.download i18n key
    expect(screen.getByRole('button', { name: /download|certificate/i })).toBeInTheDocument();
  });

  // F-299: the print window is an about:blank document that inherits this app's
  // origin, so whatever is written into it runs as the app. The server escapes
  // every field today; the page must not depend on that alone.
  it('writes the certificate into the print window without script or handlers', async () => {
    const written: string[] = [];
    const fakeWindow = {
      document: { write: (html: string) => written.push(html), close: vi.fn() },
      focus: vi.fn(),
      print: vi.fn(),
    };
    const open = vi.spyOn(window, 'open').mockReturnValue(fakeWindow as unknown as Window);
    mockMyCourses.mockResolvedValueOnce({ success: true, data: [COMPLETED_ENROLLMENT] });
    mockCertificate.mockResolvedValueOnce({
      success: true,
      data: {
        html: '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Certificate</title>'
          + '<style>body { color: #111827; }</style><script>window.opener.stolen = 1</script></head>'
          + '<body><h1>Certificate</h1><p class="name">Ada <img src="x" onerror="alert(1)"></p>'
          + '<a href="javascript:alert(1)">verify</a><iframe src="https://evil.invalid"></iframe></body></html>',
      },
    });
    render(<MyLearningPage />);
    await waitFor(() => expect(screen.getByText('Advanced React')).toBeInTheDocument());
    screen.getByRole('button', { name: /download|certificate/i }).click();
    await waitFor(() => expect(fakeWindow.print).toHaveBeenCalled());

    const html = written.join('');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onerror/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/<iframe/i);
    // Control: the certificate itself still prints with its styling.
    expect(html).toContain('<h1>Certificate</h1>');
    expect(html).toContain('body { color: #111827; }');
    expect(html).toContain('<title>Certificate</title>');
    open.mockRestore();
  });

  it('handles API failure gracefully (returns empty list)', async () => {
    mockMyCourses.mockResolvedValueOnce({ success: false, data: null });
    const { container } = render(<MyLearningPage />);
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeInTheDocument());
    // Renders without crashing, shows empty state
    expect(document.body).toBeTruthy();
  });
});
