// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';
import type { Course } from '@/lib/api/courses';

// ─── Mock contexts ────────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

// ─── Mock react-i18next ───────────────────────────────────────────────────────
vi.mock('react-i18next', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-i18next')>();
  return {
    ...orig,
    useTranslation: (_ns?: string) => ({
      t: (key: string, opts?: Record<string, unknown>) => {
        const map: Record<string, string> = {
          'level.beginner': 'Beginner',
          'level.intermediate': 'Intermediate',
          'level.advanced': 'Advanced',
          'card.by_author': `By ${opts?.name ?? ''}`,
          'card.enrolled': `${opts?.count ?? 0} enrolled`,
        };
        return map[key] ?? key;
      },
      i18n: { language: 'en' },
    }),
  };
});

// ─── Stub @/lib/courseContentSecurity ─────────────────────────────────────────
vi.mock('@/lib/courseContentSecurity', () => ({
  normalizeCourseMediaUrl: (url?: string | null) => url || null,
}));

// ─── Stub HeroUI Card/Chip to avoid jsdom issues ─────────────────────────────
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div data-testid="card" className={className}>{children}</div>
    ),
    CardBody: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div data-testid="card-body" className={className}>{children}</div>
    ),
    Chip: ({ children, size: _s, variant: _v, color: _c }: { children: React.ReactNode; size?: string; variant?: string; color?: string }) => (
      <span data-testid="chip">{children}</span>
    ),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeCourse = (overrides: Partial<Course> = {}): Course => ({
  id: 1,
  author_user_id: 10,
  category_id: 3,
  title: 'Introduction to Timebanking',
  slug: 'intro-timebanking',
  summary: 'Learn the basics of time credits and timebanking.',
  description: null,
  cover_image: null,
  level: 'beginner',
  visibility: 'public',
  enrollment_type: 'self_paced',
  status: 'published',
  moderation_status: 'approved',
  credit_cost: '0',
  learner_credit_reward: '1',
  instructor_credit_reward: '0.5',
  prerequisites: null,
  enrollment_count: 42,
  completion_count: 10,
  rating_avg: '4.5',
  rating_count: 8,
  published_at: '2025-01-01T00:00:00Z',
  author: { id: 10, name: 'Jane Doe', avatar_url: null },
  category: { id: 3, name: 'Community', slug: 'community', description: null },
  sections: [],
  is_enrolled: false,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────

describe('CourseCard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders the course title', async () => {
    const { CourseCard } = await import('./CourseCard');
    render(<CourseCard course={makeCourse()} />);
    expect(screen.getByText('Introduction to Timebanking')).toBeInTheDocument();
  });

  it('renders the course summary', async () => {
    const { CourseCard } = await import('./CourseCard');
    render(<CourseCard course={makeCourse()} />);
    expect(screen.getByText('Learn the basics of time credits and timebanking.')).toBeInTheDocument();
  });

  it('renders the level chip', async () => {
    const { CourseCard } = await import('./CourseCard');
    render(<CourseCard course={makeCourse({ level: 'beginner' })} />);
    expect(screen.getByText('Beginner')).toBeInTheDocument();
  });

  it('renders the category chip when category is set', async () => {
    const { CourseCard } = await import('./CourseCard');
    render(<CourseCard course={makeCourse()} />);
    expect(screen.getByText('Community')).toBeInTheDocument();
  });

  it('does not render a category chip when category is null', async () => {
    const { CourseCard } = await import('./CourseCard');
    render(<CourseCard course={makeCourse({ category: null })} />);
    const chips = screen.getAllByTestId('chip');
    // Only the level chip — no category
    expect(chips).toHaveLength(1);
  });

  it('renders enrollment count via translation key', async () => {
    const { CourseCard } = await import('./CourseCard');
    render(<CourseCard course={makeCourse({ enrollment_count: 42 })} />);
    expect(screen.getByText('42 enrolled')).toBeInTheDocument();
  });

  it('renders author name via translation key', async () => {
    const { CourseCard } = await import('./CourseCard');
    render(<CourseCard course={makeCourse()} />);
    expect(screen.getByText('By Jane Doe')).toBeInTheDocument();
  });

  it('links to the correct tenant course path', async () => {
    const { CourseCard } = await import('./CourseCard');
    render(<CourseCard course={makeCourse({ slug: 'intro-timebanking' })} />);
    const link = screen.getByRole('link');
    expect((link as HTMLAnchorElement).href).toContain('/test/courses/intro-timebanking');
  });

  it('shows an img tag with alt text when cover_image is provided', async () => {
    const { CourseCard } = await import('./CourseCard');
    render(<CourseCard course={makeCourse({ cover_image: 'https://example.com/cover.jpg' })} />);
    const img = screen.getByRole('img', { name: 'Introduction to Timebanking' });
    expect(img).toBeInTheDocument();
    expect((img as HTMLImageElement).src).toBe('https://example.com/cover.jpg');
  });

  it('shows a fallback icon when cover_image is null', async () => {
    const { CourseCard } = await import('./CourseCard');
    const { container } = render(<CourseCard course={makeCourse({ cover_image: null })} />);
    // No img element — SVG icon rendered instead
    expect(container.querySelector('img')).toBeNull();
    // The icon placeholder svg or container is rendered
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('does not render author span when author is undefined', async () => {
    const { CourseCard } = await import('./CourseCard');
    render(<CourseCard course={makeCourse({ author: undefined })} />);
    expect(screen.queryByText(/By /)).toBeNull();
  });

  it('renders intermediate level chip correctly', async () => {
    const { CourseCard } = await import('./CourseCard');
    render(<CourseCard course={makeCourse({ level: 'intermediate' })} />);
    expect(screen.getByText('Intermediate')).toBeInTheDocument();
  });

  it('does not render summary when summary is null', async () => {
    const { CourseCard } = await import('./CourseCard');
    render(<CourseCard course={makeCourse({ summary: null })} />);
    expect(screen.queryByText('Learn the basics')).toBeNull();
  });

  // AWID feedback: "attractive visuals". A course without a picture showed a
  // grey box with a faint cap; it now gets a cover in a colour, as offers,
  // events and blog posts do.
  it('gives a course without a picture a cover in a colour, not a grey box', async () => {
    const { CourseCard } = await import('./CourseCard');
    render(<CourseCard course={makeCourse({ cover_image: null })} />);
    const cover = screen.getByTestId('course-card-cover');
    expect(cover).toHaveAttribute('aria-hidden', 'true');
    expect(cover.getAttribute('data-colour')).toBeTruthy();
    expect(cover.getAttribute('data-colour')).not.toBe('slate');
  });

  it('gives courses in the same category the same colour', async () => {
    const { CourseCard } = await import('./CourseCard');
    const { unmount } = render(<CourseCard course={makeCourse({ id: 1, title: 'A' })} />);
    const first = screen.getByTestId('course-card-cover').getAttribute('data-colour');
    unmount();
    render(<CourseCard course={makeCourse({ id: 99, title: 'B' })} />);
    expect(screen.getByTestId('course-card-cover').getAttribute('data-colour')).toBe(first);
  });

  // Warmth plan W3: the page hands each card its category's colour from the
  // community's course categories, shared out in id order.
  it('uses the colour its page gives it', async () => {
    const { CourseCard } = await import('./CourseCard');
    render(<CourseCard course={makeCourse({ cover_image: null })} coverColour="teal" />);
    expect(screen.getByTestId('course-card-cover')).toHaveAttribute('data-colour', 'teal');
  });

  it('shows the picture, not a cover, when the course has one', async () => {
    const { CourseCard } = await import('./CourseCard');
    render(<CourseCard course={makeCourse({ cover_image: '/uploads/course.jpg' })} />);
    expect(screen.queryByTestId('course-card-cover')).toBeNull();
    expect(screen.getByRole('img', { name: 'Introduction to Timebanking' })).toBeInTheDocument();
  });
});
