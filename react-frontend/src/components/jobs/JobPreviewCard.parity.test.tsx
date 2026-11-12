// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Drift guard: the live preview beside the job form must look like the real
 * card on the jobs page (JobCard in pages/jobs/JobsPage). Both are rendered
 * from the same vacancy and the parts that carry meaning are compared, so a
 * change to one that is not made to the other fails here (audit of the live
 * previews, 12 Nov 2026).
 *
 * Not compared: the commitment label's look. The real card draws it as a
 * grey chip, the preview as a grey pill of its own; only its words are
 * compared.
 */

import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/contexts', () => createMockContexts());
vi.mock('@/contexts/TenantContext', () => ({ useTenant: createMockContexts().useTenant }));
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { JobCard } from '@/pages/jobs/JobsPage';
import { JobPreviewCard } from './JobPreviewCard';

type Vacancy = ComponentProps<typeof JobCard>['vacancy'];

/** The lucide picture an element shows, by its class (lucide-heart, …). */
const pictureOf = (element: Element | null): string | undefined =>
  Array.from(element?.querySelector('svg')?.classList ?? []).find((name) => name.startsWith('lucide-'));

function renderBoth(vacancy: Vacancy) {
  render(
    <>
      <div data-testid="real">
        <JobCard vacancy={vacancy} />
      </div>
      <JobPreviewCard
        title={vacancy.title}
        description={vacancy.description}
        type={vacancy.type}
        commitment={vacancy.commitment}
        location={vacancy.location ?? ''}
        isRemote={vacancy.is_remote}
      />
    </>,
  );
  return { real: screen.getByTestId('real'), preview: screen.getByTestId('job-preview') };
}

const vacancy: Vacancy = {
  id: 42,
  title: 'Community café helper',
  description: 'Serve tea and cake on Saturday mornings.',
  location: 'Riverside hall',
  is_remote: false,
  type: 'volunteer',
  commitment: 'part_time',
  category: null,
  skills: [],
  hours_per_week: null,
  time_credits: null,
  deadline: null,
  status: 'open',
  views_count: 0,
  applications_count: 0,
  created_at: '2026-11-01T10:00:00Z',
  creator: { id: 5, name: 'Maeve', avatar_url: null },
  organization: null,
  has_applied: false,
  application_status: null,
  is_saved: false,
  is_featured: false,
  salary_min: null,
  salary_max: null,
  salary_type: null,
  salary_currency: null,
  salary_negotiable: false,
};

describe('JobPreviewCard and the real JobCard stay alike', () => {
  it('show the same title', () => {
    const { real } = renderBoth(vacancy);
    expect(screen.getByTestId('job-preview-title').textContent).toBe(real.querySelector('h3')?.textContent);
  });

  it.each(['paid', 'volunteer', 'timebank'] as const)('give a %s job the same tile: its colour and its picture', (type) => {
    renderBoth({ ...vacancy, type });
    const realTile = screen.getByTestId('job-card-mark');
    const previewTile = screen.getByTestId('job-preview-type-tile');
    expect(previewTile.getAttribute('data-colour')).toBe(realTile.getAttribute('data-colour'));
    expect(pictureOf(previewTile)).toBe(pictureOf(realTile));
  });

  it.each(['paid', 'volunteer', 'timebank'] as const)("show a %s job's type label in the same words and colour", (type) => {
    const { real } = renderBoth({ ...vacancy, type });
    const previewLabel = screen.getByTestId('job-preview-type');
    const realLabel = Array.from(real.querySelectorAll('.chip')).find((chip) => chip.textContent === previewLabel.textContent);
    expect(realLabel).toBeDefined();
    expect(previewLabel.className).toBe(realLabel?.className);
  });

  it('show the same commitment, in words', () => {
    const { real } = renderBoth(vacancy);
    const words = screen.getByTestId('job-preview-commitment').textContent;
    expect(Array.from(real.querySelectorAll('.chip')).some((chip) => chip.textContent === words)).toBe(true);
  });

  it('show the place when the job is not remote', () => {
    const { real, preview } = renderBoth(vacancy);
    const place = (root: HTMLElement) => root.querySelector('.lucide-map-pin')?.parentElement?.textContent;
    expect(place(real)).toBe('Riverside hall');
    expect(place(preview)).toBe(place(real));
  });

  it('show "Remote" instead of the place, never both, when it is remote', () => {
    const { real, preview } = renderBoth({ ...vacancy, is_remote: true });
    const remote = (root: HTMLElement) => root.querySelector('.lucide-wifi')?.parentElement?.textContent;
    expect(remote(real)).toBeTruthy();
    expect(remote(preview)).toBe(remote(real));
    expect(real.querySelector('.lucide-map-pin')).toBeNull();
    expect(preview.querySelector('.lucide-map-pin')).toBeNull();
  });
});
