// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/contexts', () => createMockContexts({
  useTenant: () => ({
    tenant: { id: 2, name: 'Hour Timebank', slug: 'test' },
    branding: { name: 'Hour Timebank' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  }),
}));

import CommunityThankYousPage from './CommunityThankYousPage';

const note = (overrides: Record<string, unknown> = {}) => ({
  id: 5,
  message: 'Thanks for fixing my bike!',
  created_at: '2026-11-10T12:00:00Z',
  sender: { id: 10, name: 'Aoife', avatar_url: null },
  receiver: { id: 11, name: 'Brian', avatar_url: null },
  ...overrides,
});

describe('CommunityThankYousPage', () => {
  beforeEach(() => {
    mockApi.get.mockReset();
  });

  it('shows the notes members chose to show, with first names, under the community title', async () => {
    mockApi.get.mockResolvedValueOnce({ success: true, data: [note()], meta: { has_more: false } });
    render(<CommunityThankYousPage />);

    expect(await screen.findByText('Thanks for fixing my bike!')).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith('/v2/community/thank-yous');
    expect(screen.getByRole('heading', { name: 'Thank-yous in Hour Timebank' })).toBeInTheDocument();
    const card = screen.getByTestId('community-thank-you-5');
    expect(card).toHaveTextContent('Aoife');
    expect(card).toHaveTextContent('To Brian');
    expect(screen.getByRole('link', { name: 'Aoife' })).toHaveAttribute('href', '/test/profile/10');
    expect(screen.getByRole('link', { name: 'To Brian' })).toHaveAttribute('href', '/test/profile/11');
  });

  it('says what the page is and how to send a thank-you when there is nothing to show', async () => {
    mockApi.get.mockResolvedValueOnce({ success: true, data: [], meta: { has_more: false } });
    render(<CommunityThankYousPage />);

    expect(await screen.findByText('No thank-yous to show yet')).toBeInTheDocument();
    expect(screen.getByText(/open their profile and choose “Say thanks”/)).toBeInTheDocument();
  });

  it('shows the shared load-error panel, not the empty page, when the notes cannot load — and retries', async () => {
    mockApi.get
      .mockResolvedValueOnce({ success: false, error: 'Forbidden' })
      .mockResolvedValueOnce({ success: true, data: [note()], meta: { has_more: false } });
    render(<CommunityThankYousPage />);

    expect(await screen.findByTestId('load-error')).toBeInTheDocument();
    expect(screen.queryByText('No thank-yous to show yet')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Thanks for fixing my bike!')).toBeInTheDocument();
  });

  it('loads older notes with the cursor and adds them below', async () => {
    mockApi.get
      .mockResolvedValueOnce({ success: true, data: [note()], meta: { has_more: true, cursor: 'NQ==' } })
      .mockResolvedValueOnce({ success: true, data: [note({ id: 4, message: 'An older thank-you' })], meta: { has_more: false } });
    render(<CommunityThankYousPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Show older thank-yous' }));

    expect(await screen.findByText('An older thank-you')).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenLastCalledWith('/v2/community/thank-yous?cursor=NQ%3D%3D');
    expect(screen.getByText('Thanks for fixing my bike!')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Show older thank-yous' })).toBeNull());
  });

  it('offers no ranking, count per person or search by person', async () => {
    mockApi.get.mockResolvedValueOnce({ success: true, data: [note()], meta: { has_more: false } });
    render(<CommunityThankYousPage />);
    await screen.findByText('Thanks for fixing my bike!');

    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText(/most thanked/i)).toBeNull();
  });
});
