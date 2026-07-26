// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

// JobOwnerBanner imports useConfirm from the DIRECT path '@/components/ui/ConfirmDialog',
// so the override has to live on that specifier — a mock of the '@/components/ui' barrel
// would never be consulted. The real hook needs both a <ConfirmDialogProvider> (absent from
// test-utils) and a portal round-trip to resolve, which is infrastructure this component
// test has no business owning, so the hook is stubbed while every other export of the
// module stays real.
const mockConfirm = vi.fn();
vi.mock('@/components/ui/ConfirmDialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/ConfirmDialog')>();
  return {
    ...actual,
    useConfirm: () => mockConfirm,
  };
});

import { JobOwnerBanner } from './JobOwnerBanner';
import type { JobVacancy } from './JobDetailTypes';

function makeVacancy(overrides: Partial<JobVacancy> = {}): JobVacancy {
  return {
    id: 42,
    title: 'Frontend Developer',
    description: 'Build things',
    location: 'Remote',
    is_remote: true,
    type: 'paid',
    commitment: 'full_time',
    category: null,
    skills: [],
    skills_required: null,
    hours_per_week: null,
    time_credits: null,
    contact_email: null,
    contact_phone: null,
    deadline: null,
    status: 'open',
    views_count: 10,
    applications_count: 3,
    created_at: '2026-01-01T00:00:00Z',
    user_id: 1,
    creator: { id: 1, name: 'Alice', avatar_url: null },
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

const tenantPath = (p: string) => `/test${p}`;
const onVacancyUpdated = vi.fn();

describe('JobOwnerBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the owner banner card', () => {
    render(<JobOwnerBanner vacancy={makeVacancy()} tenantPath={tenantPath} onVacancyUpdated={onVacancyUpdated} />);
    // The real GlassCard puts the `glass-card` class on its root element.
    expect(document.body.querySelector('.glass-card')).toBeInTheDocument();
    expect(screen.getByText('You posted this vacancy')).toBeInTheDocument();
  });

  it('shows applicant count when applications_count > 0', () => {
    render(
      <JobOwnerBanner
        vacancy={makeVacancy({ applications_count: 5 })}
        tenantPath={tenantPath}
        onVacancyUpdated={onVacancyUpdated}
      />
    );
    expect(screen.getByText(/^5 applicant\(s\)/)).toBeInTheDocument();
    expect(screen.queryByText(/No applicants yet/)).not.toBeInTheDocument();
  });

  it('shows the no-applicants copy when applications_count is 0', () => {
    render(
      <JobOwnerBanner
        vacancy={makeVacancy({ applications_count: 0 })}
        tenantPath={tenantPath}
        onVacancyUpdated={onVacancyUpdated}
      />
    );
    expect(screen.getByText(/No applicants yet/)).toBeInTheDocument();
  });

  it('renders Edit, Analytics, and Kanban board links with correct hrefs', () => {
    render(<JobOwnerBanner vacancy={makeVacancy()} tenantPath={tenantPath} onVacancyUpdated={onVacancyUpdated} />);
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/test/jobs/42/edit');
    expect(hrefs).toContain('/test/jobs/42/analytics');
    expect(hrefs).toContain('/test/jobs/42/kanban');
  });

  it('shows "Close vacancy" button when vacancy is open', () => {
    render(<JobOwnerBanner vacancy={makeVacancy({ status: 'open' })} tenantPath={tenantPath} onVacancyUpdated={onVacancyUpdated} />);
    // detail.close_vacancy resolves to "Close Vacancy" from public/locales/en/jobs.json.
    expect(screen.getByRole('button', { name: 'Close Vacancy' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument();
  });

  it('shows "Reopen vacancy" button when vacancy is closed', () => {
    render(<JobOwnerBanner vacancy={makeVacancy({ status: 'closed' })} tenantPath={tenantPath} onVacancyUpdated={onVacancyUpdated} />);
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
  });

  it('does NOT show "Close vacancy" button when status is closed', () => {
    render(<JobOwnerBanner vacancy={makeVacancy({ status: 'closed' })} tenantPath={tenantPath} onVacancyUpdated={onVacancyUpdated} />);
    expect(screen.queryByRole('button', { name: 'Close Vacancy' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
  });

  it('calls api.put and onVacancyUpdated when closing vacancy is confirmed', async () => {
    mockConfirm.mockResolvedValueOnce(true);
    vi.mocked(api.put).mockResolvedValueOnce({ success: true });

    render(<JobOwnerBanner vacancy={makeVacancy({ status: 'open' })} tenantPath={tenantPath} onVacancyUpdated={onVacancyUpdated} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close Vacancy' }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/v2/jobs/42', { status: 'closed' });
    });
    expect(onVacancyUpdated).toHaveBeenCalled();
  });

  it('does not call api.put when close vacancy confirm is cancelled', async () => {
    mockConfirm.mockResolvedValueOnce(false);

    render(<JobOwnerBanner vacancy={makeVacancy({ status: 'open' })} tenantPath={tenantPath} onVacancyUpdated={onVacancyUpdated} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close Vacancy' }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalled();
    });
    expect(api.put).not.toHaveBeenCalled();
    expect(onVacancyUpdated).not.toHaveBeenCalled();
  });

  it('calls api.put with status:open when reopening a closed vacancy', async () => {
    mockConfirm.mockResolvedValueOnce(true);
    vi.mocked(api.put).mockResolvedValueOnce({ success: true });

    render(<JobOwnerBanner vacancy={makeVacancy({ status: 'closed' })} tenantPath={tenantPath} onVacancyUpdated={onVacancyUpdated} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/v2/jobs/42', { status: 'open' });
    });
    expect(onVacancyUpdated).toHaveBeenCalled();
  });

  it('does not call onVacancyUpdated when api.put returns success:false on close', async () => {
    mockConfirm.mockResolvedValueOnce(true);
    vi.mocked(api.put).mockResolvedValueOnce({ success: false });

    render(<JobOwnerBanner vacancy={makeVacancy({ status: 'open' })} tenantPath={tenantPath} onVacancyUpdated={onVacancyUpdated} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close Vacancy' }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/v2/jobs/42', { status: 'closed' });
    });
    expect(onVacancyUpdated).not.toHaveBeenCalled();
  });
});
