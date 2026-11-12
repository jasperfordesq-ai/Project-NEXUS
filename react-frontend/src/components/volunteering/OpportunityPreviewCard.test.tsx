// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { Chip } from '@/components/ui/Chip';
import { OpportunityPreviewCard, type OpportunityPreviewCardProps } from './OpportunityPreviewCard';

const base: OpportunityPreviewCardProps = {
  title: '', description: '', location: '', isRemote: false, organisationId: null, organisationName: null,
};

describe('OpportunityPreviewCard — how the opportunity will look, as it is typed', () => {
  it('invites the words before anything is typed, in a quieter colour', () => {
    render(<OpportunityPreviewCard {...base} />);
    for (const id of ['opportunity-preview-title', 'opportunity-preview-organisation', 'opportunity-preview-description']) {
      expect(screen.getByTestId(id).className, id).toContain('text-theme-subtle');
      expect(screen.getByTestId(id).textContent, id).not.toBe('');
    }
  });

  it('shows the title, organisation, description and place as they are chosen', () => {
    render(
      <OpportunityPreviewCard
        {...base}
        title="Garden helpers"
        description="Two hours of weeding on Saturday mornings."
        location="Riverside allotments"
        organisationId={12}
        organisationName="Riverside Growers"
      />,
    );
    const preview = screen.getByTestId('opportunity-preview');
    expect(preview).toHaveTextContent('Garden helpers');
    expect(preview).toHaveTextContent('Riverside Growers');
    expect(preview).toHaveTextContent('Two hours of weeding on Saturday mornings.');
    expect(preview).toHaveTextContent('Riverside allotments');
    expect(screen.getByTestId('opportunity-preview-title').className).toContain('text-theme-primary');
  });

  it('says so when the opportunity can be done from home', () => {
    const { rerender } = render(<OpportunityPreviewCard {...base} />);
    expect(screen.queryByTestId('opportunity-preview-remote')).toBeNull();
    rerender(<OpportunityPreviewCard {...base} isRemote />);
    expect(screen.getByTestId('opportunity-preview-remote')).toHaveTextContent('Remote');
  });

  it('shows the organisation tile, as the real card does', () => {
    render(<OpportunityPreviewCard {...base} organisationId={12} organisationName="Riverside Growers" />);
    expect(screen.getByTestId('opportunity-preview-organisation-tile')).toBeInTheDocument();
  });

  // The real card shows the organisation's logo in its tile; the preview
  // always showed the coloured tile (audit of the live previews, 12 Nov 2026).
  it("shows the organisation's logo in the tile when it has one, as the real card does", () => {
    render(<OpportunityPreviewCard {...base} organisationId={12} organisationName="Riverside Growers" organisationLogoUrl="/uploads/riverside.png" />);
    // CoverTile swaps its coloured tile for the logo (an avatar, which shows
    // the picture once it has loaded) only when it is given a logo.
    expect(screen.queryByTestId('opportunity-preview-organisation-tile')).toBeNull();
    expect(screen.getByTestId('opportunity-preview').querySelector('.avatar')).not.toBeNull();
  });

  // The real card marks "Remote" with a soft accent chip; the preview used
  // plain grey text (audit, 12 Nov 2026).
  it('marks a remote opportunity with the same soft accent chip as the real card', () => {
    render(
      <>
        <OpportunityPreviewCard {...base} isRemote />
        <Chip data-testid="real-remote" size="sm" variant="soft" color="accent">Remote</Chip>
      </>,
    );
    expect(screen.getByTestId('opportunity-preview-remote').className).toBe(screen.getByTestId('real-remote').className);
  });

  it('is a picture of a card, not a card: nothing in it can be clicked', () => {
    render(<OpportunityPreviewCard {...base} title="Garden helpers" organisationId={12} organisationName="Riverside Growers" />);
    const preview = screen.getByTestId('opportunity-preview');
    expect(preview.querySelector('a')).toBeNull();
    expect(preview.querySelector('button')).toBeNull();
  });
});
