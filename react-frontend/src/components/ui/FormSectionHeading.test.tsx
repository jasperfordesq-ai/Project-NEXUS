// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Calendar from 'lucide-react/icons/calendar';
import { FormSectionHeading } from './FormSectionHeading';
import { SiteVividContext } from '@/contexts/SiteAccentContext';
import { feedTypeColour } from '@/components/feed/feedTypeColours';

describe('FormSectionHeading', () => {
  it('shows the title and hint, with the picture hidden from screen readers', () => {
    render(<FormSectionHeading icon={Calendar} kind="event" title="When and where" hint="Pick a date" />);
    expect(screen.getByRole('heading', { level: 2, name: 'When and where' })).toBeInTheDocument();
    expect(screen.getByText('Pick a date')).toBeInTheDocument();
    expect(screen.getByTestId('form-section-icon')).toHaveAttribute('aria-hidden', 'true');
  });

  it("uses the kind's pale label colours in soft strength", () => {
    render(<FormSectionHeading icon={Calendar} kind="event" title="When" />);
    expect(screen.getByTestId('form-section-icon').className).toContain(feedTypeColour('event').label);
  });

  // Warmth phase 5: a vivid community's form tiles are filled, with a white picture.
  it("fills the tile with the kind's colour and a white picture in vivid", () => {
    render(
      <SiteVividContext.Provider value>
        <FormSectionHeading icon={Calendar} kind="event" title="When" />
      </SiteVividContext.Provider>,
    );
    const tile = screen.getByTestId('form-section-icon');
    expect(tile.className).toContain('bg-emerald-700');
    expect(tile.className).toContain('text-white');
    expect(tile.className).not.toContain('bg-emerald-100');
  });

  it('uses the community button shade in vivid for offers and requests', () => {
    render(
      <SiteVividContext.Provider value>
        <FormSectionHeading icon={Calendar} kind="listing" title="What" />
      </SiteVividContext.Provider>,
    );
    const tile = screen.getByTestId('form-section-icon');
    expect(tile.className).toContain('bg-accent-strong');
    expect(tile.className).toContain('text-white');
  });
});
