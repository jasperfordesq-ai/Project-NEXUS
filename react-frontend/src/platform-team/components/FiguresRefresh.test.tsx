// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// The page formats with getFormattingLocale() (language + community region).
// Pin it to the locale these expected strings are written in.
vi.mock('@/lib/helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/helpers')>()),
  getFormattingLocale: () => 'en',
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'time' in options ? `${key}|${String(options.time)}` : key,
    i18n: { language: 'en' },
  }),
}));

import { FiguresRefresh, withRefresh } from './FiguresRefresh';

describe('FiguresRefresh', () => {
  it('asks again when pressed', () => {
    const onRefresh = vi.fn();
    render(<FiguresRefresh onRefresh={onRefresh} loading={false} generatedAt={undefined} refused={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'home.refresh' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('says when the figures were worked out, in hours and minutes', () => {
    render(
      <FiguresRefresh onRefresh={vi.fn()} loading={false} generatedAt="2026-11-16T10:05:30+00:00" refused={false} />,
    );

    const time = new Date('2026-11-16T10:05:30+00:00').toLocaleTimeString('en', { timeStyle: 'short' });
    expect(screen.getByText(`shared.figures_from|${time}`)).toBeInTheDocument();
  });

  it('says nothing about when, for an older server that does not send it, or a time it cannot read', () => {
    const { rerender } = render(
      <FiguresRefresh onRefresh={vi.fn()} loading={false} generatedAt={undefined} refused={false} />,
    );
    expect(screen.queryByText(/shared\.figures_from/)).not.toBeInTheDocument();

    rerender(<FiguresRefresh onRefresh={vi.fn()} loading={false} generatedAt="not a time" refused={false} />);
    expect(screen.queryByText(/shared\.figures_from/)).not.toBeInTheDocument();
  });

  it('says so when checking again was refused', () => {
    render(<FiguresRefresh onRefresh={vi.fn()} loading={false} generatedAt={undefined} refused />);

    expect(screen.getByText('translations.recount_refused')).toBeInTheDocument();
  });
});

describe('withRefresh', () => {
  it('adds the refresh flag to an address, keeping what it already asks', () => {
    expect(withRefresh('/v2/platform-team/usage', false)).toBe('/v2/platform-team/usage');
    expect(withRefresh('/v2/platform-team/usage', true)).toBe('/v2/platform-team/usage?refresh=1');
    expect(withRefresh('/v2/platform-team/usage?month=2026-11', true)).toBe(
      '/v2/platform-team/usage?month=2026-11&refresh=1',
    );
  });
});
