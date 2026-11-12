// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Drift guard: the live preview beside the event form must look like the real
 * card on the events page (EventCard in pages/events/EventsPage). Both are
 * rendered from the same event and the parts that carry meaning are compared,
 * so a change to one that is not made to the other fails here (audit of the
 * live previews, 12 Nov 2026).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import { createCanonicalEventFixture } from '@/test/events-test-harness';
import { categoryColour, colourForSeed, paletteFor } from '@/lib/categoryColours';
import { coverSeed } from '@/lib/coverSeeds';
import { eventIsoToLocalInput } from '@/lib/eventLocalDateTime';
import type { Event } from '@/lib/events-api';

vi.mock('@/contexts/TenantContext', () => ({ useTenant: createMockContexts().useTenant }));
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
// The community's category list: it colours kind 4; any other kind falls back
// to its seed. Both cards read it through this one hook.
vi.mock('@/hooks/useCategoryListColours', () => ({
  useCategoryListColours: () => (id?: number | string | null) => (id === 4 ? 'teal' : undefined),
}));

import { EventCard } from '@/pages/events/EventsPage';
import { EventPreviewCard } from './EventPreviewCard';

const classes = (element: Element | null): string[] =>
  (element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

/** The size and show/hide classes of a picture, which decide the layout. */
const layoutClasses = (element: Element | null): string[] =>
  classes(element).filter((name) => /^(sm:)?(hidden|block|h-\d+|w-\d+|w-full)$/.test(name)).sort();

function renderBoth(event: Event) {
  const wallClock = eventIsoToLocalInput(event.schedule.start_at, event.schedule.timezone);
  const [datePart = '', timePart = ''] = wallClock.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  render(
    <>
      <div data-testid="real">
        <EventCard event={event} />
      </div>
      <EventPreviewCard
        id={event.id}
        title={event.title}
        description={event.description ?? ''}
        startDate={{ year: year ?? 0, month: month ?? 0, day: day ?? 0 }}
        startTime={event.schedule.all_day ? null : { hour: hour ?? 0, minute: minute ?? 0 }}
        allDay={event.schedule.all_day}
        timeZone={event.schedule.timezone}
        location={event.location.label ?? ''}
        categoryId={event.category?.id ?? null}
        categoryName={event.category?.name ?? null}
        imageSrc={event.primary_image?.url ?? null}
      />
    </>,
  );
  return { real: screen.getByTestId('real'), preview: screen.getByTestId('event-preview') };
}

const base = createCanonicalEventFixture();
const event: Event = createCanonicalEventFixture({
  id: 42,
  title: 'Repair café',
  description: 'Bring something broken.',
  category: { id: 4, name: 'Workshops', slug: 'workshops', colour: null },
  location: { ...base.location, label: 'Community hall' },
  schedule: { ...base.schedule, start_at: '2030-06-01T14:00:00Z', end_at: '2030-06-01T16:00:00Z', timezone: 'America/New_York' },
});

describe('EventPreviewCard and the real EventCard stay alike', () => {
  it('show the same title', () => {
    const { real } = renderBoth(event);
    expect(screen.getByTestId('event-preview-title').textContent).toBe(real.querySelector('h3')?.textContent);
  });

  it.each([
    ['a kind the community list colours', { id: 4, name: 'Workshops', slug: 'workshops', colour: null }],
    ['a kind the list does not colour', { id: 9, name: 'Walks', slug: 'walks', colour: null }],
    ['no kind', null],
  ] as const)('give the date tile the same colour and the same day, for %s', (_label, category) => {
    renderBoth({ ...event, category: category ? { ...category } : null });
    const realTile = screen.getByTestId('event-date-tile');
    const previewTile = screen.getByTestId('event-preview-date-tile');
    expect(previewTile.getAttribute('data-colour')).toBe(realTile.getAttribute('data-colour'));
    expect(previewTile.textContent).toBe(realTile.textContent);
  });

  it("show the kind's label in the kind's colour", () => {
    renderBoth(event);
    const realLabel = screen.getByTestId('event-category-label');
    const previewLabel = screen.getByTestId('event-preview-category');
    expect(previewLabel.textContent).toBe(realLabel.textContent);
    const band = categoryColour(realLabel.getAttribute('data-colour')).band.split(' ');
    expect(classes(previewLabel)).toEqual(expect.arrayContaining(band));
  });

  it('show the same time, with the same time-zone name', () => {
    const { real } = renderBoth(event);
    const realTime = real.querySelector('.lucide-clock')?.parentElement?.textContent;
    expect(realTime).toMatch(/10:00/);
    expect(screen.getByTestId('event-preview-time').textContent).toBe(realTime);
  });

  it('say "all day" the same way', () => {
    const { real } = renderBoth({ ...event, schedule: { ...event.schedule, all_day: true } });
    expect(screen.getByTestId('event-preview-time').textContent).toBe(real.querySelector('.lucide-clock')?.parentElement?.textContent);
  });

  it('show the same place', () => {
    const { real, preview } = renderBoth(event);
    const place = (root: HTMLElement) => root.querySelector('.lucide-map-pin')?.parentElement?.querySelector('.truncate')?.textContent;
    expect(place(real)).toBe('Community hall');
    expect(place(preview)).toBe(place(real));
  });

  it('lay out the cover picture the same way: a banner on a phone, a small picture beside the title from sm', () => {
    const withCover: Event = { ...event, primary_image: { url: '/uploads/events/cafe.jpg', alt_text: 'Repair café', description: null } };
    const { real, preview } = renderBoth(withCover);
    const realFrames = Array.from(real.querySelectorAll('[data-testid="smart-image"]')).map(layoutClasses);
    const previewPictures = Array.from(preview.querySelectorAll('img')).map(layoutClasses);
    expect(realFrames).toHaveLength(2);
    expect(previewPictures).toEqual(realFrames);
  });

  it('fall back to the same seed colour as the card when nothing else colours it', () => {
    renderBoth({ ...event, category: null });
    expect(screen.getByTestId('event-preview-date-tile').getAttribute('data-colour')).toBe(
      colourForSeed(coverSeed.event(42), paletteFor(null)),
    );
  });
});
