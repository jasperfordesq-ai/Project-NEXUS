// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { createMockContexts } from '@/test/mock-contexts';

const mockGetUnmetNeeds = vi.hoisted(() => vi.fn());
const mockSummarise = vi.hoisted(() => vi.fn());

vi.mock('@/admin/api/adminApi', () => ({
  adminMatching: {
    getUnmetNeeds: mockGetUnmetNeeds,
    summariseUnmetNeeds: mockSummarise,
  },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

import { UnmetNeedsPage } from './UnmetNeedsPage';

const NOBODY = {
  id: 7,
  title: 'Lift to hospital appointments',
  description: 'Twice a month, mornings.',
  category_name: 'Transport',
  created_at: '2026-10-20 09:00:00',
  days_waiting: 31,
  matched_members: 0,
  requester_id: 41,
  requester_name: 'Alice Member',
};
const SHOWN = { ...NOBODY, id: 8, title: 'Help with a form', category_name: null, days_waiting: 16, matched_members: 3, requester_id: 42, requester_name: 'Bob Member' };

const page = (overrides = {}) => ({
  success: true,
  data: {
    items: [NOBODY, SHOWN],
    summary: { total: 2, no_match: 1, no_response: 1 },
    waiting_days: 14,
    ai_available: true,
    ...overrides,
  },
});

function renderPage() {
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <UnmetNeedsPage />
      </MemoryRouter>
    </HelmetProvider>,
  );
}

describe('UnmetNeedsPage (broker)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('lists the requests nobody has taken up, who asked, how long ago and how many members were matched', async () => {
    mockGetUnmetNeeds.mockResolvedValue(page());
    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Unmet needs' })).toBeInTheDocument();
    expect(screen.getByText(/posted at least 14 days ago/)).toBeInTheDocument();
    expect(screen.getByText('Waiting: 2. Matched with nobody: 1. Shown to members, no response: 1.')).toBeInTheDocument();

    // The heading is there before the rows are; wait for the rows.
    const link = await screen.findByRole('link', { name: 'Lift to hospital appointments' });
    expect(link).toHaveAttribute('href', '/test/listings/7');
    expect(screen.getByText('Alice Member')).toBeInTheDocument();
    expect(screen.getByText('31 days')).toBeInTheDocument();
    expect(screen.getByText('Nobody')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('says so when there is nothing waiting', async () => {
    mockGetUnmetNeeds.mockResolvedValue(page({ items: [], summary: { total: 0, no_match: 0, no_response: 0 } }));
    renderPage();

    expect(await screen.findByText('No unmet needs')).toBeInTheDocument();
    expect(screen.getByText('Every request older than 14 days has had a response.')).toBeInTheDocument();
  });

  it('never shows a failed load as an empty list', async () => {
    mockGetUnmetNeeds.mockRejectedValue(new Error('offline'));
    renderPage();

    expect(await screen.findByText("Couldn't load unmet needs")).toBeInTheDocument();
    expect(screen.queryByText('No unmet needs')).not.toBeInTheDocument();
  });

  it('offers no AI button to a community without AI, and the list is all there', async () => {
    mockGetUnmetNeeds.mockResolvedValue(page({ ai_available: false }));
    renderPage();

    expect(await screen.findByRole('link', { name: 'Lift to hospital appointments' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask the AI what is missing' })).not.toBeInTheDocument();
  });

  it('asks the AI only when the button is pressed, and shows what it says as plain text', async () => {
    mockGetUnmetNeeds.mockResolvedValue(page());
    mockSummarise.mockResolvedValue({
      success: true,
      data: {
        summary: 'Most of what is waiting is about getting around.',
        themes: [{ need: 'Transport', requests: 2, suggestion: 'Ask members who drive.' }],
      },
    });
    renderPage();

    const button = await screen.findByRole('button', { name: 'Ask the AI what is missing' });
    expect(screen.getByText(/No names are sent/)).toBeInTheDocument();
    expect(mockSummarise).not.toHaveBeenCalled();

    await userEvent.click(button);

    expect(await screen.findByText('Most of what is waiting is about getting around.')).toBeInTheDocument();
    expect(screen.getByText('Transport (2)')).toBeInTheDocument();
    expect(screen.getByText('Ask members who drive.')).toBeInTheDocument();
    expect(mockSummarise).toHaveBeenCalledTimes(1);
  });

  it('says when the AI could not answer, and keeps the list', async () => {
    mockGetUnmetNeeds.mockResolvedValue(page());
    mockSummarise.mockResolvedValue({ success: false, error: 'AI service encountered an error.' });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Ask the AI what is missing' }));

    await waitFor(() =>
      expect(screen.getByText('The AI could not answer just now. The list is not affected.')).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: 'Lift to hospital appointments' })).toBeInTheDocument();
  });
});
