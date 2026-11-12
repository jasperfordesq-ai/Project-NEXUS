// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/contexts', () => createMockContexts());

import { SimilarJobs } from './SimilarJobs';
import type { JobVacancy } from './JobDetailTypes';

const tenantPath = (p: string) => `/test${p}`;

/** Minimal valid JobVacancy stub */
function makeJob(overrides: Partial<JobVacancy> = {}): JobVacancy {
  return {
    id: 1,
    title: 'Community Gardener',
    description: 'Help maintain our garden',
    location: 'Dublin',
    is_remote: false,
    type: 'volunteer',
    commitment: 'flexible',
    category: null,
    skills: [],
    skills_required: null,
    hours_per_week: null,
    time_credits: null,
    contact_email: null,
    contact_phone: null,
    deadline: null,
    status: 'active',
    views_count: 0,
    applications_count: 0,
    created_at: '2025-01-01T00:00:00Z',
    user_id: 10,
    creator: { id: 10, name: 'Jane Doe', avatar_url: null },
    organization: null,
    has_applied: false,
    application_id: null,
    application_status: null,
    application_stage: null,
    is_saved: false,
    is_featured: false,
    featured_until: null,
    tagline: null,
    video_url: null,
    benefits: null,
    company_size: null,
    salary_min: null,
    salary_max: null,
    salary_type: null,
    salary_currency: null,
    salary_negotiable: false,
    expired_at: null,
    renewed_at: null,
    renewal_count: 0,
    blind_hiring: false,
    ...overrides,
  };
}

describe('SimilarJobs — empty list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders no heading or job cards when jobs array is empty', () => {
    // The ToastProvider wrapper always renders a toast-container div, so we cannot
    // assert container.firstChild is null. Instead confirm no meaningful output appears.
    render(<SimilarJobs jobs={[]} tenantPath={tenantPath} />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('SimilarJobs — populated list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the section heading', () => {
    render(<SimilarJobs jobs={[makeJob()]} tenantPath={tenantPath} />);
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('renders one card per job', () => {
    const jobs = [
      makeJob({ id: 1, title: 'Job A' }),
      makeJob({ id: 2, title: 'Job B' }),
      makeJob({ id: 3, title: 'Job C' }),
    ];
    render(<SimilarJobs jobs={jobs} tenantPath={tenantPath} />);
    expect(screen.getByText('Job A')).toBeInTheDocument();
    expect(screen.getByText('Job B')).toBeInTheDocument();
    expect(screen.getByText('Job C')).toBeInTheDocument();
  });

  it('each card links to the correct tenant job path', () => {
    const job = makeJob({ id: 99, title: 'Special Job' });
    render(<SimilarJobs jobs={[job]} tenantPath={tenantPath} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/test/jobs/99');
  });

  // Warmth phase 5: the job tile was a fixed blue; the jobs list's cards use
  // the community colour.
  it('draws each job tile in the community colour', () => {
    render(<SimilarJobs jobs={[makeJob()]} tenantPath={tenantPath} />);
    const tile = screen.getByTestId('similar-job-tile');
    expect(tile.className).toContain('from-accent/20');
    expect(tile.className).not.toMatch(/blue-/);
    expect(tile.querySelector('svg')?.getAttribute('class')).toContain('text-accent');
  });

  it('shows the organisation name when organization is present', () => {
    const job = makeJob({
      organization: { id: 5, name: 'Green Corp', logo_url: null },
    });
    render(<SimilarJobs jobs={[job]} tenantPath={tenantPath} />);
    expect(screen.getByText('Green Corp')).toBeInTheDocument();
  });

  it('falls back to creator name when organization is null', () => {
    const job = makeJob({ organization: null, creator: { id: 10, name: 'Jane Doe', avatar_url: null } });
    render(<SimilarJobs jobs={[job]} tenantPath={tenantPath} />);
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });
});

describe('SimilarJobs — location / remote chips', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the remote chip when is_remote is true', () => {
    const job = makeJob({ is_remote: true, location: null });
    render(<SimilarJobs jobs={[job]} tenantPath={tenantPath} />);
    // i18n key "remote" — rendered as chip text
    expect(screen.getByText(/remote/i)).toBeInTheDocument();
  });

  it('shows location chip when is_remote is false and location is set', () => {
    const job = makeJob({ is_remote: false, location: 'Cork' });
    render(<SimilarJobs jobs={[job]} tenantPath={tenantPath} />);
    expect(screen.getByText('Cork')).toBeInTheDocument();
  });

  it('shows no location chip when is_remote is false and location is null', () => {
    const job = makeJob({ is_remote: false, location: null });
    render(<SimilarJobs jobs={[job]} tenantPath={tenantPath} />);
    // Should not throw and should render no location text
    expect(screen.queryByText(/Cork/)).not.toBeInTheDocument();
  });
});

describe('SimilarJobs — job type chips', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders type chip for paid job', () => {
    const job = makeJob({ type: 'paid' });
    render(<SimilarJobs jobs={[job]} tenantPath={tenantPath} />);
    // i18n key "type.paid"
    expect(screen.getByText(/type\.paid|paid/i)).toBeInTheDocument();
  });

  it('renders type chip for timebank job', () => {
    const job = makeJob({ type: 'timebank' });
    render(<SimilarJobs jobs={[job]} tenantPath={tenantPath} />);
    expect(screen.getByText(/type\.timebank|timebank/i)).toBeInTheDocument();
  });
});
