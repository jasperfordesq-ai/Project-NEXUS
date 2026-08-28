// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { I18nProvider } from '@heroui/react';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import { DatePicker } from './DatePicker';

vi.mock('@/contexts', () => createMockContexts());

/**
 * Date ENTRY has to agree with date DISPLAY.
 *
 * React Aria decides segment order and first-day-of-week from its own locale,
 * which defaults to the browser's language when no I18nProvider is mounted.
 * Before App wrapped the tree in one, a member could see a British date in a
 * listing and an American date-entry field on the same screen — the display
 * side followed the language chosen in the app, the input side followed the
 * laptop.
 *
 * These assertions read the rendered segment order rather than trusting that a
 * provider is present, so they still fail if the provider is removed, moved
 * above the language subscription, or given the wrong locale.
 */
function segmentOrder(): string[] {
  return screen
    .getAllByRole('spinbutton')
    .map((segment) => segment.getAttribute('aria-label') ?? '')
    .map((label) => label.toLowerCase())
    .filter((label) => /day|month|year/.test(label))
    .map((label) => (/day/.test(label) ? 'day' : /month/.test(label) ? 'month' : 'year'));
}

describe('DatePicker segment order follows the application locale', () => {
  it('puts the day before the month for an Irish community', () => {
    render(
      <I18nProvider locale="en-IE">
        <DatePicker label="Event date" aria-label="Event date" />
      </I18nProvider>,
    );

    const order = segmentOrder();
    expect(order.indexOf('day')).toBeLessThan(order.indexOf('month'));
  });

  it('puts the day before the month for a UK community', () => {
    render(
      <I18nProvider locale="en-GB">
        <DatePicker label="Event date" aria-label="Event date" />
      </I18nProvider>,
    );

    const order = segmentOrder();
    expect(order.indexOf('day')).toBeLessThan(order.indexOf('month'));
  });

  it('control: an American locale really does order it the other way', () => {
    // Without this the two assertions above could pass against a component
    // that ignores the locale entirely.
    render(
      <I18nProvider locale="en-US">
        <DatePicker label="Event date" aria-label="Event date" />
      </I18nProvider>,
    );

    const order = segmentOrder();
    expect(order.indexOf('month')).toBeLessThan(order.indexOf('day'));
  });
});
