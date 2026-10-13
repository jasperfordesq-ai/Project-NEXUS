// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import { DatePicker } from './DatePicker';
import { CalendarDate } from '@internationalized/date';

vi.mock('@/contexts', () => createMockContexts());

describe('DatePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<DatePicker aria-label="Pick a date" />);
    expect(container.firstChild).not.toBeNull();
  });

  it('renders a label when provided as string', () => {
    render(<DatePicker label="Event Date" aria-label="Event Date" />);
    expect(screen.getByText('Event Date')).toBeInTheDocument();
  });

  it('renders date field segments in the document', () => {
    render(<DatePicker label="Birth Date" aria-label="Birth Date" />);
    // HeroUI DateField.Input renders individual segments (month, day, year).
    // In jsdom these appear as spinbuttons inside the date field group.
    const spinbuttons = screen.getAllByRole('spinbutton');
    expect(spinbuttons.length).toBeGreaterThan(0);
  });

  it('renders a trigger button (calendar opener) by default', () => {
    render(<DatePicker aria-label="Pick a date" />);
    // The trigger button may not have an explicit role="button" in all HeroUI
    // builds — look for any button element in the rendered output.
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders a description when provided', () => {
    render(
      <DatePicker
        aria-label="Pick a date"
        description="Select a date for the event"
      />
    );
    expect(screen.getByText('Select a date for the event')).toBeInTheDocument();
  });

  it('renders an error message when isInvalid=true and errorMessage is provided', () => {
    render(
      <DatePicker
        aria-label="Pick a date"
        isInvalid
        errorMessage="Date is required"
      />
    );
    expect(screen.getByText('Date is required')).toBeInTheDocument();
  });

  it('does NOT render description when isInvalid=true (error takes precedence)', () => {
    render(
      <DatePicker
        aria-label="Pick a date"
        isInvalid
        errorMessage="Must pick a future date"
        description="Some hint"
      />
    );
    expect(screen.getByText('Must pick a future date')).toBeInTheDocument();
    expect(screen.queryByText('Some hint')).not.toBeInTheDocument();
  });

  it('accepts a CalendarDate value via props without throwing', () => {
    const date = new CalendarDate(2025, 6, 15);
    expect(() => {
      render(<DatePicker aria-label="Pick a date" value={date} />);
    }).not.toThrow();
  });

  it('renders startContent when provided', () => {
    render(
      <DatePicker
        aria-label="Pick a date"
        startContent={<span data-testid="start-icon">icon</span>}
      />
    );
    expect(screen.getByTestId('start-icon')).toBeInTheDocument();
  });

  it('renders endContent when provided', () => {
    render(
      <DatePicker
        aria-label="Pick a date"
        endContent={<span data-testid="end-icon">end</span>}
      />
    );
    expect(screen.getByTestId('end-icon')).toBeInTheDocument();
  });

  it('passes fullWidth class to the wrapper', () => {
    const { container } = render(
      <DatePicker aria-label="Pick a date" fullWidth />
    );
    // The root element or a child should carry 'w-full'
    const wFull = container.querySelector('.w-full');
    expect(wFull).not.toBeNull();
  });

  it('accepts custom className without throwing', () => {
    expect(() => {
      render(
        <DatePicker aria-label="Pick a date" className="my-custom-class" />
      );
    }).not.toThrow();
  });

  it('hands the picker min/max bounds to its calendar (HeroUI otherwise defaults to 1900–2099)', async () => {
    render(
      <DatePicker
        aria-label="Pick a date"
        defaultOpen
        value={new CalendarDate(2026, 6, 15)}
        minValue={new CalendarDate(2026, 6, 10)}
        maxValue={new CalendarDate(2026, 6, 20)}
      />
    );

    const grid = await screen.findByRole('grid');
    const cellFor = (day: number) => Array.from(grid.querySelectorAll('[role="gridcell"]'))
      .find((cell) => cell.textContent?.trim() === String(day));
    // Outside the bounds the calendar refuses the day; inside it offers it.
    expect(cellFor(5)?.querySelector('[aria-disabled="true"]') ?? cellFor(5)?.getAttribute('aria-disabled'))
      .toBeTruthy();
    expect(cellFor(25)?.querySelector('[aria-disabled="true"]') ?? cellFor(25)?.getAttribute('aria-disabled'))
      .toBeTruthy();
    expect(cellFor(12)?.querySelector('[aria-disabled="true"]')).toBeNull();
  });

  // SKIPPED: Opening the calendar popover via pointer events in jsdom is not
  // reliable — React Aria's FocusScope + portal-based Popover requires a real
  // browser environment. Calendar grid interaction is therefore not tested here.
});
