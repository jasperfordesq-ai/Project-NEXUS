// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { colourForSeed, paletteFor } from '@/lib/categoryColours';
import { coverSeed } from '@/lib/coverSeeds';
import { eventLocalInputToIso } from '@/lib/eventLocalDateTime';
import { formatDateTime } from '@/lib/helpers';
import { EventPreviewCard, type EventPreviewCardProps } from './EventPreviewCard';

vi.mock('@/hooks/useCategoryListColours', () => ({
  useCategoryListColours: () => (id?: number | null) => (id === 4 ? 'teal' : undefined),
}));

const base: EventPreviewCardProps = {
  title: '', description: '', startDate: null, startTime: null, allDay: false, location: '',
  categoryId: null, categoryName: null, imageSrc: null,
};

describe('EventPreviewCard — how the event will look, as it is typed', () => {
  it('invites the words and the date before anything is chosen, in a quieter colour', () => {
    render(<EventPreviewCard {...base} />);
    expect(screen.getByTestId('event-preview-title').className).toContain('text-theme-subtle');
    expect(screen.getByTestId('event-preview-title').textContent).not.toBe('');
    expect(screen.getByTestId('event-preview-description').textContent).not.toBe('');
    expect(screen.getByTestId('event-preview-time')).toHaveTextContent('Choose a date and time');
  });

  it('shows the name, description and place as they are typed', () => {
    render(<EventPreviewCard {...base} title="Repair café" description="Bring something broken." location="Community hall" />);
    const preview = screen.getByTestId('event-preview');
    expect(preview).toHaveTextContent('Repair café');
    expect(preview).toHaveTextContent('Bring something broken.');
    expect(preview).toHaveTextContent('Community hall');
  });

  it('shows the day as typed in the date tile, and the time beside the clock', () => {
    render(<EventPreviewCard {...base} startDate={{ year: 2026, month: 12, day: 5 }} startTime={{ hour: 10, minute: 30 }} />);
    const tile = screen.getByTestId('event-preview-date-tile');
    expect(tile).toHaveTextContent('5');
    expect(tile.textContent).toMatch(/DEC/i);
    expect(screen.getByTestId('event-preview-time').textContent).toMatch(/10[:.]30/);
  });

  // The real card names the event's time zone after the time ("10:30 GMT");
  // the preview showed the bare time (audit of the live previews, 12 Nov 2026).
  it("names the event's time zone after the time, exactly as the card will", () => {
    render(
      <EventPreviewCard {...base} startDate={{ year: 2026, month: 12, day: 5 }} startTime={{ hour: 10, minute: 30 }} timeZone="America/New_York" />,
    );
    const instant = eventLocalInputToIso('2026-12-05T10:30', 'America/New_York')!;
    const asTheCardFormatsIt = formatDateTime(instant, {
      hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short',
    });
    expect(asTheCardFormatsIt).toMatch(/EST|GMT-5/);
    expect(screen.getByTestId('event-preview-time')).toHaveTextContent(asTheCardFormatsIt);
  });

  // From the `sm` width the real card shows the cover as a small picture
  // beside the title, not as a banner (audit, 12 Nov 2026).
  it('shows the cover as a banner on a phone and as a small picture beside the title from the sm width, like the card', () => {
    render(<EventPreviewCard {...base} title="Repair café" imageSrc="blob:cover" />);
    const pictures = Array.from(screen.getByTestId('event-preview').querySelectorAll('img'));
    expect(pictures).toHaveLength(2);
    const banner = pictures.find((img) => img.className.includes('sm:hidden'));
    const thumbnail = pictures.find((img) => img.className.includes('sm:block'));
    expect(banner).toBeDefined();
    expect(thumbnail?.className).toContain('hidden');
    expect(thumbnail?.className).toContain('h-20 w-28');
    // Beside the title, in the same row.
    expect(thumbnail?.parentElement).toContainElement(screen.getByTestId('event-preview-title'));
  });

  it('says "all day" instead of a time for an all-day event', () => {
    render(<EventPreviewCard {...base} startDate={{ year: 2026, month: 12, day: 5 }} allDay />);
    expect(screen.getByTestId('event-preview-time')).toHaveTextContent(/all day/i);
  });

  it("wears the colour of the event's kind on the date tile and the kind's label, like the real card", () => {
    render(<EventPreviewCard {...base} categoryId={4} categoryName="Workshops" />);
    expect(screen.getByTestId('event-preview-date-tile')).toHaveAttribute('data-colour', 'teal');
    expect(screen.getByTestId('event-preview-category')).toHaveTextContent('Workshops');
    expect(screen.getByTestId('event-preview-category').className).toContain('teal');
  });

  // The preview used a fixed seed, so an event the community's category list
  // does not colour showed a different colour from its card (audit, 12 Nov 2026).
  it('when editing, colours the date tile by the event, as its card does', () => {
    const palette = paletteFor(null);
    const id = [7, 42, 3, 11, 19].find((n) => colourForSeed(coverSeed.event(n), palette) !== colourForSeed('event-preview', palette))!;
    render(<EventPreviewCard {...base} id={id} />);
    expect(screen.getByTestId('event-preview-date-tile')).toHaveAttribute('data-colour', colourForSeed(coverSeed.event(id), palette));
  });

  it("falls back to the kind's own seed, as the card does, when the list has no colour for it", () => {
    const palette = paletteFor(null);
    const categoryId = [9, 12, 15, 21, 30].find((n) => colourForSeed(coverSeed.event('preview', n), palette) !== colourForSeed('event-preview', palette))!;
    render(<EventPreviewCard {...base} categoryId={categoryId} categoryName="Walks" />);
    expect(screen.getByTestId('event-preview-date-tile')).toHaveAttribute('data-colour', colourForSeed(coverSeed.event('preview', categoryId), palette));
  });

  it('nudges for a cover picture until there is one', () => {
    const { rerender } = render(<EventPreviewCard {...base} />);
    expect(screen.getByTestId('event-preview-cover-nudge')).toBeInTheDocument();
    rerender(<EventPreviewCard {...base} imageSrc="blob:cover" />);
    expect(screen.queryByTestId('event-preview-cover-nudge')).toBeNull();
    expect(screen.getByTestId('event-preview').querySelector('img')).toHaveAttribute('alt', '');
  });

  it('is a picture of a card, not a card: nothing in it can be clicked', () => {
    render(<EventPreviewCard {...base} title="Repair café" />);
    const preview = screen.getByTestId('event-preview');
    expect(preview.querySelector('a')).toBeNull();
    expect(preview.querySelector('button')).toBeNull();
  });
});
