// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Drift guard: the live preview beside the volunteering opportunity form must
 * look like the real card on the volunteering page (OpportunityCard in
 * pages/volunteering/VolunteeringPage). Both are rendered from the same
 * opportunity and the parts that carry meaning are compared, so a change to
 * one that is not made to the other fails here (audit of the live previews,
 * 12 Nov 2026).
 *
 * Not compared: the real card's category chip, dates and skills — the form's
 * preview does not show them.
 */

import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// The real card reads useTenant from the barrel; other modules on the page
// read it from its own file. Only that hook is replaced, in both places.
vi.mock('@/contexts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts')>()),
  useTenant: createMockContexts().useTenant,
}));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: createMockContexts().useTenant }));
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { OpportunityCard } from '@/pages/volunteering/VolunteeringPage';
import { OpportunityPreviewCard } from './OpportunityPreviewCard';

type Opportunity = ComponentProps<typeof OpportunityCard>['opportunity'];

function renderBoth(opportunity: Opportunity) {
  render(
    <>
      <div data-testid="real">
        <OpportunityCard opportunity={opportunity} />
      </div>
      <OpportunityPreviewCard
        title={opportunity.title}
        description={opportunity.description}
        location={opportunity.location}
        isRemote={opportunity.is_remote}
        organisationId={opportunity.organization.id}
        organisationName={opportunity.organization.name}
        organisationLogoUrl={opportunity.organization.logo_url ?? null}
      />
    </>,
  );
  return { real: screen.getByTestId('real'), preview: screen.getByTestId('opportunity-preview') };
}

const opportunity: Opportunity = {
  id: 42,
  title: 'Garden helpers',
  description: 'Two hours of weeding on Saturday mornings.',
  location: 'Riverside allotments',
  skills_needed: '',
  start_date: null,
  end_date: null,
  is_active: true,
  is_remote: false,
  category: null,
  category_id: null,
  organization: { id: 12, name: 'Riverside Growers', logo_url: null },
  created_at: '2026-11-01T10:00:00Z',
};

describe('OpportunityPreviewCard and the real OpportunityCard stay alike', () => {
  it('show the same title, organisation and description', () => {
    const { real } = renderBoth(opportunity);
    expect(screen.getByTestId('opportunity-preview-title').textContent).toBe(real.querySelector('a.text-lg')?.textContent);
    expect(screen.getByTestId('opportunity-preview-organisation').textContent).toBe(
      real.querySelector('a.text-sm.text-theme-muted, span.text-sm.text-theme-muted')?.textContent,
    );
    expect(screen.getByTestId('opportunity-preview-description').textContent).toBe(
      real.querySelector('p.line-clamp-2')?.textContent,
    );
  });

  it("give an organisation with no logo the same tile, in its own colour and texture", () => {
    renderBoth(opportunity);
    const realTile = screen.getByTestId('opportunity-organisation-tile');
    const previewTile = screen.getByTestId('opportunity-preview-organisation-tile');
    expect(previewTile.getAttribute('data-colour')).toBe(realTile.getAttribute('data-colour'));
    expect(previewTile.innerHTML).toBe(realTile.innerHTML);
  });

  it("show the organisation's logo instead of the tile, both of them", () => {
    const { real, preview } = renderBoth({ ...opportunity, organization: { ...opportunity.organization, logo_url: '/uploads/riverside.png' } });
    expect(screen.queryByTestId('opportunity-organisation-tile')).toBeNull();
    expect(screen.queryByTestId('opportunity-preview-organisation-tile')).toBeNull();
    expect(real.querySelector('.avatar')).not.toBeNull();
    expect(preview.querySelector('.avatar')).not.toBeNull();
  });

  it('mark a remote opportunity with the same chip', () => {
    const { real } = renderBoth({ ...opportunity, is_remote: true });
    const realChip = real.querySelector('.lucide-globe')?.closest('.chip');
    const previewChip = screen.getByTestId('opportunity-preview-remote');
    expect(realChip).not.toBeNull();
    expect(previewChip.className).toBe(realChip?.className);
    expect(previewChip.textContent).toBe(realChip?.textContent);
  });

  it('show the same place', () => {
    const { real, preview } = renderBoth(opportunity);
    const place = (root: HTMLElement) => root.querySelector('.lucide-map-pin')?.parentElement?.textContent;
    expect(place(real)).toBe('Riverside allotments');
    expect(place(preview)).toBe(place(real));
  });
});
