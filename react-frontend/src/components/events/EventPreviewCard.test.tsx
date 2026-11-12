// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
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
