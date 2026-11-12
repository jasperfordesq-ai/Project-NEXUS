// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { colourForSeed, paletteFor } from '@/lib/categoryColours';
import { coverSeed } from '@/lib/coverSeeds';
import { JobPreviewCard, type JobPreviewCardProps } from './JobPreviewCard';

const base: JobPreviewCardProps = {
  title: '', description: '', type: 'paid', commitment: 'flexible', location: '', isRemote: false,
};

describe('JobPreviewCard — how the vacancy will look, as it is typed', () => {
  it('invites a title and a description before anything is typed, in a quieter colour', () => {
    render(<JobPreviewCard {...base} />);
    expect(screen.getByTestId('job-preview-title').className).toContain('text-theme-subtle');
    expect(screen.getByTestId('job-preview-title').textContent).not.toBe('');
    expect(screen.getByTestId('job-preview-description-placeholder').textContent).not.toBe('');
  });

  it('shows the title, description and place as they are typed', () => {
    render(<JobPreviewCard {...base} title="Community gardener" description="Look after the shared beds." location="Riverside" />);
    const preview = screen.getByTestId('job-preview');
    expect(preview).toHaveTextContent('Community gardener');
    expect(preview).toHaveTextContent('Look after the shared beds.');
    expect(preview).toHaveTextContent('Riverside');
  });

  it("says the type and the commitment in the site's own words", () => {
    render(<JobPreviewCard {...base} type="volunteer" commitment="part_time" />);
    expect(screen.getByTestId('job-preview-type')).toHaveTextContent('Volunteer');
    expect(screen.getByTestId('job-preview-commitment')).toHaveTextContent('Part Time');
  });

  it('shows no label for a type or commitment it does not know, rather than a raw code', () => {
    render(<JobPreviewCard {...base} type="mystery" commitment="" />);
    expect(screen.queryByTestId('job-preview-type')).toBeNull();
    expect(screen.queryByTestId('job-preview-commitment')).toBeNull();
  });

  // The real card colours the tile with colourForSeed(coverSeed.jobType(type), palette).
  // The picture must use the same rule, or card and picture would disagree.
  it('colours the tile by the job type with the same rule as the real card', () => {
    const palette = paletteFor(null);
    for (const type of ['paid', 'volunteer', 'timebank']) {
      const { unmount } = render(<JobPreviewCard {...base} type={type} />);
      expect(screen.getByTestId('job-preview-type-tile'), type).toHaveAttribute(
        'data-colour',
        colourForSeed(coverSeed.jobType(type), palette),
      );
      unmount();
    }
  });

  it('shows the description as plain words, never as markup', () => {
    render(<JobPreviewCard {...base} description="<p>Hello <strong>there</strong></p>" />);
    const preview = screen.getByTestId('job-preview');
    expect(preview).toHaveTextContent('Hello there');
    expect(preview.querySelector('strong')).toBeNull();
  });

  it('says so when the job can be done from home', () => {
    render(<JobPreviewCard {...base} isRemote />);
    expect(screen.getByTestId('job-preview-remote')).toHaveTextContent('Remote');
  });

  // The real card shows "Remote" OR the place, never both. Switching Remote
  // on disables the place box but keeps its text, so the preview showed
  // "Riverside · Remote" (audit of warmth phase 5, 12 Nov 2026).
  it('shows "Remote" instead of the place when the job can be done from home, as the real card does', () => {
    render(<JobPreviewCard {...base} location="Riverside" isRemote />);
    expect(screen.getByTestId('job-preview-remote')).toHaveTextContent('Remote');
    expect(screen.getByTestId('job-preview')).not.toHaveTextContent('Riverside');
  });

  it('is a picture of a card, not a card: nothing in it can be clicked', () => {
    render(<JobPreviewCard {...base} title="Community gardener" />);
    const preview = screen.getByTestId('job-preview');
    expect(preview.querySelector('a')).toBeNull();
    expect(preview.querySelector('button')).toBeNull();
  });
});
