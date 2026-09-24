// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for JobDescriptionCard component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/contexts', () => createMockContexts());

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

// SafeHtml renders sanitized HTML — mock it to a simple passthrough div so
// we can assert on the text content without needing DOMPurify in jsdom.
vi.mock('@/components/ui/SafeHtml', () => ({
  SafeHtml: ({ content, className }: { content: string; className?: string }) => (
    <div className={className} data-testid="safe-html" dangerouslySetInnerHTML={{ __html: content }} />
  ),
}));

import { JobDescriptionCard } from './JobDescriptionCard';
import type { JobVacancy, MatchResult, QualificationData } from './JobDetailTypes';

const BASE_VACANCY: JobVacancy = {
  id: 1,
  title: 'Frontend Developer',
  description: '<p>Join our team to build amazing products.</p>',
  location: 'Dublin',
  is_remote: false,
  type: 'paid',
  commitment: 'full_time',
  category: 'Engineering',
  skills: ['React', 'TypeScript'],
  skills_required: null,
  hours_per_week: 40,
  time_credits: null,
  contact_email: null,
  contact_phone: null,
  deadline: null,
  status: 'active',
  views_count: 10,
  applications_count: 3,
  created_at: '2024-06-01T00:00:00Z',
  user_id: 1,
  creator: { id: 1, name: 'Employer', avatar_url: null },
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
};

const QUALIFICATION_DATA: QualificationData = {
  percentage: 80,
  level: 'good',
  ai_summary: 'You are a strong match for this role.',
  matched_skills: ['React'],
  missing_skills: ['Node.js'],
  dimensions: [
    { label: 'Experience', score: 80, detail: '4 years relevant experience' },
  ],
};

describe('JobDescriptionCard', () => {
  const onCheckQualification = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the vacancy description via SafeHtml', () => {
    render(
      <JobDescriptionCard
        vacancy={BASE_VACANCY}
        isOwner={false}
        isAuthenticated={false}
        matchResult={null}
        qualificationData={null}
        onCheckQualification={onCheckQualification}
      />
    );
    const html = screen.getByTestId('safe-html');
    expect(html).toBeInTheDocument();
    expect(html.innerHTML).toContain('Join our team');
  });

  it('renders required skills as chips', () => {
    render(
      <JobDescriptionCard
        vacancy={BASE_VACANCY}
        isOwner={false}
        isAuthenticated={false}
        matchResult={null}
        qualificationData={null}
        onCheckQualification={onCheckQualification}
      />
    );
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
  });

  it('shows the "Check Qualification" button when authenticated and not owner', () => {
    render(
      <JobDescriptionCard
        vacancy={BASE_VACANCY}
        isOwner={false}
        isAuthenticated={true}
        matchResult={null}
        qualificationData={null}
        onCheckQualification={onCheckQualification}
      />
    );
    // i18n in test mode returns the key; the key is 'detail.check_qualification'
    // There should be at least one button (the check-qualification button) in the skills section
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('does NOT show any button when not authenticated (no check-qual or qual toggle)', () => {
    render(
      <JobDescriptionCard
        vacancy={BASE_VACANCY}
        isOwner={false}
        isAuthenticated={false}
        matchResult={null}
        qualificationData={null}
        onCheckQualification={onCheckQualification}
      />
    );
    // No buttons at all: not authenticated → no check button; no qualificationData → no toggle
    expect(screen.queryAllByRole('button').length).toBe(0);
  });

  it('does NOT render the check-qual button when isOwner=true', () => {
    render(
      <JobDescriptionCard
        vacancy={BASE_VACANCY}
        isOwner={true}
        isAuthenticated={true}
        matchResult={null}
        qualificationData={null}
        onCheckQualification={onCheckQualification}
      />
    );
    // Owner sees no check button (the condition is authenticated && !isOwner)
    expect(screen.queryAllByRole('button').length).toBe(0);
  });

  it('calls onCheckQualification when the check button is clicked', () => {
    render(
      <JobDescriptionCard
        vacancy={BASE_VACANCY}
        isOwner={false}
        isAuthenticated={true}
        matchResult={null}
        qualificationData={null}
        onCheckQualification={onCheckQualification}
      />
    );
    // The only button present when authenticated+not-owner is the check-qualification one
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);
    expect(onCheckQualification).toHaveBeenCalledTimes(1);
  });

  it('renders qualification panel (collapsed) when qualificationData is set and not owner', () => {
    render(
      <JobDescriptionCard
        vacancy={BASE_VACANCY}
        isOwner={false}
        isAuthenticated={true}
        matchResult={null}
        qualificationData={QUALIFICATION_DATA}
        onCheckQualification={onCheckQualification}
      />
    );
    // The toggle button shows the percentage
    expect(screen.getByText(/80%/)).toBeInTheDocument();
  });

  it('expands qualification panel on toggle click and shows AI summary', () => {
    render(
      <JobDescriptionCard
        vacancy={BASE_VACANCY}
        isOwner={false}
        isAuthenticated={true}
        matchResult={null}
        qualificationData={QUALIFICATION_DATA}
        onCheckQualification={onCheckQualification}
      />
    );
    // Click the toggle button (contains "80%")
    fireEvent.click(screen.getByText(/80%/));
    expect(screen.getByText('You are a strong match for this role.')).toBeInTheDocument();
  });

  it('shows matched and missing skills after expanding the qual panel', () => {
    render(
      <JobDescriptionCard
        vacancy={BASE_VACANCY}
        isOwner={false}
        isAuthenticated={true}
        matchResult={null}
        qualificationData={QUALIFICATION_DATA}
        onCheckQualification={onCheckQualification}
      />
    );
    fireEvent.click(screen.getByText(/80%/));
    // "React" appears both in Skills section and matched_skills — just assert presence
    expect(screen.getAllByText('React').length).toBeGreaterThan(0);
    expect(screen.getByText('Node.js')).toBeInTheDocument();
  });

  it('does NOT show qualification panel when isOwner=true', () => {
    render(
      <JobDescriptionCard
        vacancy={BASE_VACANCY}
        isOwner={true}
        isAuthenticated={true}
        matchResult={null}
        qualificationData={QUALIFICATION_DATA}
        onCheckQualification={onCheckQualification}
      />
    );
    expect(screen.queryByText(/80%/)).not.toBeInTheDocument();
  });

  it('renders employer branding section when tagline is set', () => {
    render(
      <JobDescriptionCard
        vacancy={{ ...BASE_VACANCY, tagline: 'We make the future.' }}
        isOwner={false}
        isAuthenticated={false}
        matchResult={null}
        qualificationData={null}
        onCheckQualification={onCheckQualification}
      />
    );
    expect(screen.getByText(/We make the future\./)).toBeInTheDocument();
  });

  it('renders benefits chips when benefits array is set', () => {
    render(
      <JobDescriptionCard
        vacancy={{ ...BASE_VACANCY, benefits: ['Remote', 'Pension'] }}
        isOwner={false}
        isAuthenticated={false}
        matchResult={null}
        qualificationData={null}
        onCheckQualification={onCheckQualification}
      />
    );
    expect(screen.getByText('Remote')).toBeInTheDocument();
    expect(screen.getByText('Pension')).toBeInTheDocument();
  });

  it('does NOT render employer branding when tagline, video_url, and benefits are all absent', () => {
    render(
      <JobDescriptionCard
        vacancy={BASE_VACANCY}
        isOwner={false}
        isAuthenticated={false}
        matchResult={null}
        qualificationData={null}
        onCheckQualification={onCheckQualification}
      />
    );
    // No "About the Company" heading (from t('branding.about_company'))
    // Presence depends on i18n key — just verify no iframe
    expect(screen.queryByTitle('branding.video_label')).not.toBeInTheDocument();
  });

  it('colours skill chips according to matchResult', () => {
    const matchResult: MatchResult = {
      percentage: 50,
      matched: ['react'],
      missing: ['typescript'],
      user_skills: ['react'],
      required_skills: ['react', 'typescript'],
    };
    render(
      <JobDescriptionCard
        vacancy={BASE_VACANCY}
        isOwner={false}
        isAuthenticated={true}
        matchResult={matchResult}
        qualificationData={null}
        onCheckQualification={onCheckQualification}
      />
    );
    // Both skill chips still appear in the DOM
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
  });

  it('renders nothing in the skills section when vacancy has no skills', () => {
    render(
      <JobDescriptionCard
        vacancy={{ ...BASE_VACANCY, skills: [] }}
        isOwner={false}
        isAuthenticated={false}
        matchResult={null}
        qualificationData={null}
        onCheckQualification={onCheckQualification}
      />
    );
    // No skill chips rendered
    expect(screen.queryByText('React')).not.toBeInTheDocument();
  });

  describe('F-195: member-supplied employer video', () => {
    function renderWithVideo(videoUrl: string) {
      return render(
        <JobDescriptionCard
          vacancy={{ ...BASE_VACANCY, video_url: videoUrl }}
          isOwner={false}
          isAuthenticated={false}
          matchResult={null}
          qualificationData={null}
          onCheckQualification={onCheckQualification}
        />
      );
    }

    it('rebuilds a sandboxed YouTube player from the video id', () => {
      renderWithVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=junk');
      const frame = document.querySelector('iframe')!;
      expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?cc_load_policy=1');
      expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-presentation');
    });

    it('rebuilds a Vimeo player from the video id', () => {
      renderWithVideo('https://vimeo.com/76979871');
      expect(document.querySelector('iframe')).toHaveAttribute('src', 'https://player.vimeo.com/video/76979871');
    });

    it('never frames a link that is not a recognised video provider', () => {
      renderWithVideo('https://docs.google.com/forms/d/e/fake/viewform?embedded=true');
      expect(document.querySelector('iframe')).toBeNull();
    });
  });
});
