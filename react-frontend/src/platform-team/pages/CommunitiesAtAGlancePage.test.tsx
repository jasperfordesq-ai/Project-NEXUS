// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get: apiGet } }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options && 'count' in options) return `${key}|${String(options.count)}|${String(options.total)}`;
      if (options && 'names' in options) return `${key}|${String(options.names)}`;
      return key;
    },
    i18n: {
      language: 'en',
      // The admin panel names every switch except a few; `maps` is one it does not.
      exists: (key: string) => key.startsWith('config.module_name_') && key !== 'config.module_name_maps',
    },
  }),
}));

import { CommunitiesAtAGlancePage, type CommunitiesGrid } from './CommunitiesAtAGlancePage';

const grid = (over: Partial<CommunitiesGrid> = {}): CommunitiesGrid => ({
  features: ['events', 'maps', 'event_attendance_credits'],
  modules: ['wallet'],
  held_platform_wide: [],
  communities: [
    { id: 2, name: 'Alpha Timebank', slug: 'alpha', active: true, features: { events: true, maps: false, event_attendance_credits: true }, modules: { wallet: true } },
    { id: 3, name: 'Beta Exchange', slug: 'beta', active: true, features: { events: true, maps: false, event_attendance_credits: false }, modules: { wallet: false } },
    { id: 4, name: 'Gamma Circle', slug: 'gamma', active: false, features: { events: false, maps: false, event_attendance_credits: false }, modules: { wallet: true } },
  ],
  ...over,
});

const cell = (table: HTMLElement, rowName: string, column: number): HTMLElement => {
  const row = within(table).getByRole('row', { name: new RegExp(`^${rowName}`) });
  return within(row).getAllByRole('cell')[column] as HTMLElement;
};

describe('CommunitiesAtAGlancePage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({ success: true, data: grid() });
  });

  it('asks the platform team request and draws a row per feature and a column per community', async () => {
    render(<CommunitiesAtAGlancePage />);

    const table = await screen.findByTestId('glance-features');
    expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/communities');
    for (const name of ['Alpha Timebank', 'Beta Exchange', 'Gamma Circle']) {
      expect(within(table).getByRole('columnheader', { name: new RegExp(name) })).toBeInTheDocument();
    }
    expect(within(table).getByRole('rowheader', { name: /config\.module_name_events/ })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: /config\.module_name_event_attendance_credits/ })).toBeInTheDocument();
  });

  it('says on or off in words in every cell, not by colour alone', async () => {
    render(<CommunitiesAtAGlancePage />);
    const table = await screen.findByTestId('glance-features');

    // Cells after the row header: [count, Alpha, Beta, Gamma].
    expect(cell(table, 'config.module_name_events', 1)).toHaveTextContent('glance.on');
    expect(cell(table, 'config.module_name_events', 2)).toHaveTextContent('glance.on');
    expect(cell(table, 'config.module_name_events', 3)).toHaveTextContent('glance.off');
  });

  it('counts the communities a feature is on in', async () => {
    render(<CommunitiesAtAGlancePage />);
    const table = await screen.findByTestId('glance-features');

    expect(cell(table, 'config.module_name_events', 0)).toHaveTextContent('glance.on_in|2|3');
  });

  it('uses its own name for a feature the admin panel does not name', async () => {
    render(<CommunitiesAtAGlancePage />);
    const table = await screen.findByTestId('glance-features');

    expect(within(table).getByRole('rowheader', { name: /glance\.feature_name\.maps/ })).toBeInTheDocument();
  });

  it('draws the core parts in a table of their own', async () => {
    render(<CommunitiesAtAGlancePage />);
    const table = await screen.findByTestId('glance-modules');

    expect(cell(table, 'config.module_name_wallet', 1)).toHaveTextContent('glance.on');
    expect(cell(table, 'config.module_name_wallet', 2)).toHaveTextContent('glance.off');
  });

  it('marks a community that is not active', async () => {
    render(<CommunitiesAtAGlancePage />);
    const table = await screen.findByTestId('glance-features');

    expect(within(table).getByRole('columnheader', { name: /Gamma Circle/ })).toHaveTextContent('glance.not_active');
    expect(within(table).getByRole('columnheader', { name: /Alpha Timebank/ })).not.toHaveTextContent('glance.not_active');
  });

  // "On" in a community's column must not be read as "working" when the
  // platform-wide switch is off.
  it('says when a feature is on in a community but held off for the whole platform', async () => {
    apiGet.mockResolvedValue({ success: true, data: grid({ held_platform_wide: ['event_attendance_credits'] }) });
    render(<CommunitiesAtAGlancePage />);
    const table = await screen.findByTestId('glance-features');

    expect(cell(table, 'config.module_name_event_attendance_credits', 1)).toHaveTextContent('glance.held');
    // Off stays off: there is nothing held about it.
    expect(cell(table, 'config.module_name_event_attendance_credits', 2)).toHaveTextContent('glance.off');
    expect(screen.getByText('glance.held_note')).toBeInTheDocument();
  });

  it('does not mention held features when none is held', async () => {
    render(<CommunitiesAtAGlancePage />);
    await screen.findByTestId('glance-features');

    expect(screen.queryByText('glance.held_note')).not.toBeInTheDocument();
  });

  it('gives a narrow screen a list that names the communities a feature is off in', async () => {
    render(<CommunitiesAtAGlancePage />);
    const list = await screen.findByTestId('glance-list');

    const events = within(list).getByTestId('glance-item-events');
    expect(events).toHaveTextContent('glance.on_in|2|3');
    // One sentence with the names inside it, so each language can order it.
    expect(events).toHaveTextContent('glance.off_in|Gamma Circle');
    expect(events).not.toHaveTextContent('Alpha Timebank');
    expect(within(list).getByTestId('glance-item-maps')).toHaveTextContent('glance.off_everywhere');
  });

  it('has no control that changes anything: one button, which reloads', async () => {
    render(<CommunitiesAtAGlancePage />);
    await screen.findByTestId('glance-features');

    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['home.refresh']);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('says so when there are no communities', async () => {
    apiGet.mockResolvedValue({ success: true, data: grid({ communities: [] }) });
    render(<CommunitiesAtAGlancePage />);

    expect(await screen.findByText('glance.empty')).toBeInTheDocument();
    expect(screen.queryByTestId('glance-features')).not.toBeInTheDocument();
  });

  it('shows the error card when the server refuses, and can try again', async () => {
    apiGet.mockResolvedValueOnce({ success: false, error: 'Forbidden' });
    render(<CommunitiesAtAGlancePage />);

    expect(await screen.findByTestId('load-error')).toBeInTheDocument();
    expect(screen.queryByTestId('glance-features')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'couldnt_load_retry' }));
    await waitFor(() => expect(screen.getByTestId('glance-features')).toBeInTheDocument());
  });
});
