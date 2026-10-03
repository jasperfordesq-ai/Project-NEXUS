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

const mockNavigate = vi.hoisted(() => vi.fn());
const mockHasFeature = vi.hoisted(() => vi.fn(() => true));
const mockUsersList = vi.hoisted(() => vi.fn());
const mockGetMessages = vi.hoisted(() => vi.fn());
const mockHelpSearch = vi.hoisted(() => vi.fn(() => [] as unknown[]));
const mockToastInfo = vi.hoisted(() => vi.fn());
const mockToggleTheme = vi.hoisted(() => vi.fn());

vi.mock('@/admin/api/adminApi', () => ({
  adminUsers: { list: mockUsersList },
  adminBroker: { getMessages: mockGetMessages },
}));

vi.mock('@/pages/help/guides/useHelpGuides', () => ({
  useHelpGuides: () => ({ search: mockHelpSearch }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: mockHasFeature,
      hasModule: vi.fn(() => true),
    }),
    useToast: () => ({ success: vi.fn(), error: vi.fn(), info: mockToastInfo, warning: vi.fn() }),
    useTheme: () => ({ resolvedTheme: 'light' as const, theme: 'system' as const, toggleTheme: mockToggleTheme, setTheme: vi.fn() }),
  }),
);

import { BrokerCommandPalette } from './BrokerCommandPalette';

function renderPalette(isOpen = true, onClose = vi.fn()) {
  render(
    <HelmetProvider>
      <MemoryRouter>
        <BrokerCommandPalette isOpen={isOpen} onClose={onClose} />
      </MemoryRouter>
    </HelmetProvider>
  );
  return onClose;
}

describe('BrokerCommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockHasFeature.mockReturnValue(true);
    mockUsersList.mockResolvedValue({ success: true, data: [] });
    mockGetMessages.mockResolvedValue({ success: true, data: [] });
    mockHelpSearch.mockReturnValue([]);
  });

  describe('sections', () => {
    it('groups the pages and the actions under headings', async () => {
      renderPalette();
      expect(await screen.findByText('Pages')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /next unreviewed message/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /pending members/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /switch theme/i })).toBeInTheDocument();
      expect(screen.queryByText('Recent')).not.toBeInTheDocument();
    });

    it('lists recently visited pages, named like the sidebar, with the record id for a detail page', async () => {
      window.localStorage.setItem('nexus_broker_recent', JSON.stringify(['/broker/messages/12', '/broker/vetting']));
      renderPalette();
      expect(await screen.findByText('Recent')).toBeInTheDocument();
      // "Vetting confirmations" appears once under Recent and once under Pages.
      expect(screen.getAllByRole('option', { name: /vetting confirmations/i })).toHaveLength(2);
      const detail = screen.getByRole('option', { name: /messages.*#12/i });
      await userEvent.setup().click(detail);
      expect(mockNavigate).toHaveBeenCalledWith('/test/broker/messages/12');
    });
  });

  describe('members', () => {
    it('searches members after a short pause and opens the member list filtered to the pick', async () => {
      mockUsersList.mockResolvedValue({ success: true, data: [{ id: 5, name: 'Alice Smith', email: 'alice@example.com' }] });
      const user = userEvent.setup();
      const onClose = renderPalette();
      await user.type(await screen.findByRole('combobox'), 'ali');

      await waitFor(() => expect(mockUsersList).toHaveBeenCalledWith({ search: 'ali', limit: 5 }));
      expect(await screen.findByText('Members')).toBeInTheDocument();
      await user.click(screen.getByRole('option', { name: /alice smith/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/test/broker/members?search=Alice%20Smith');
      expect(onClose).toHaveBeenCalled();
    });

    it('does not search on a single character', async () => {
      const user = userEvent.setup();
      renderPalette();
      await user.type(await screen.findByRole('combobox'), 'a');
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(mockUsersList).not.toHaveBeenCalled();
    });

    it('ignores a slow earlier response once the query has moved on', async () => {
      let resolveFirst: (v: unknown) => void = () => {};
      mockUsersList
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
        .mockResolvedValueOnce({ success: true, data: [{ id: 6, name: 'Bob Jones', email: 'bob@example.com' }] });
      const user = userEvent.setup();
      renderPalette();
      const input = await screen.findByRole('combobox');
      await user.type(input, 'al');
      await waitFor(() => expect(mockUsersList).toHaveBeenCalledTimes(1));
      await user.type(input, 'x');
      await waitFor(() => expect(mockUsersList).toHaveBeenCalledTimes(2));
      expect(await screen.findByRole('option', { name: /bob jones/i })).toBeInTheDocument();

      resolveFirst({ success: true, data: [{ id: 5, name: 'Alice Smith', email: 'alice@example.com' }] });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.queryByRole('option', { name: /alice smith/i })).not.toBeInTheDocument();
    });
  });

  describe('help articles', () => {
    it('offers matching broker guides and opens one inside the panel', async () => {
      mockHelpSearch.mockReturnValue([
        { audience: 'brokers', sectionId: 'vetting', articleId: 'confirm', title: 'Confirming a vetting check', summary: '', sectionTitle: 'Vetting', score: 3 },
        { audience: 'members', sectionId: 'profile', articleId: 'photo', title: 'Changing your photo', summary: '', sectionTitle: 'Profile', score: 1 },
      ]);
      const user = userEvent.setup();
      renderPalette();
      await user.type(await screen.findByRole('combobox'), 'vetting');

      expect(await screen.findByText('Help articles')).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /changing your photo/i })).not.toBeInTheDocument();
      await user.click(screen.getByRole('option', { name: /confirming a vetting check/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/test/broker/help/vetting/confirm');
    });
  });

  describe('actions', () => {
    it('"Next unreviewed message" opens the first message waiting, inside the unreviewed queue', async () => {
      mockGetMessages.mockResolvedValue({ success: true, data: [{ id: 42 }, { id: 43 }] });
      const user = userEvent.setup();
      renderPalette();
      await user.click(await screen.findByRole('option', { name: /next unreviewed message/i }));
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/test/broker/messages/42?queue=unreviewed'));
      expect(mockGetMessages).toHaveBeenCalledWith({ filter: 'unreviewed' });
    });

    it('says nothing is waiting when the unreviewed queue is empty', async () => {
      const user = userEvent.setup();
      renderPalette();
      await user.click(await screen.findByRole('option', { name: /next unreviewed message/i }));
      await waitFor(() => expect(mockToastInfo).toHaveBeenCalledWith('Nothing waiting'));
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('"Pending members" opens the member list filtered to pending', async () => {
      const user = userEvent.setup();
      renderPalette();
      await user.click(await screen.findByRole('option', { name: /pending members/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/test/broker/members?status=pending');
    });

    it('"Switch theme" toggles the theme without leaving the page', async () => {
      const user = userEvent.setup();
      renderPalette();
      await user.click(await screen.findByRole('option', { name: /switch theme/i }));
      expect(mockToggleTheme).toHaveBeenCalledTimes(1);
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('keyboard navigation flows into the Actions section and Enter runs the action', async () => {
      const user = userEvent.setup();
      renderPalette();
      const input = await screen.findByRole('combobox');
      await user.type(input, 'theme');
      // No page matches "theme"; the only row left is the action, and it is active.
      expect(screen.getAllByRole('option')).toHaveLength(1);
      expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option').id);
      await user.keyboard('{Enter}');
      expect(mockToggleTheme).toHaveBeenCalledTimes(1);
    });
  });

  it('lists all broker destinations when open with no query', async () => {
    renderPalette();
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /dashboard/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('option', { name: /match approvals/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /vetting/i })).toBeInTheDocument();
  });

  it('filters destinations as the user types', async () => {
    const user = userEvent.setup();
    renderPalette();
    const input = await screen.findByRole('combobox');

    await user.type(input, 'vett');

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /vetting/i })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /dashboard/i })).not.toBeInTheDocument();
    });
  });

  it('navigates to the active destination on Enter and closes', async () => {
    const user = userEvent.setup();
    const onClose = renderPalette();
    const input = await screen.findByRole('combobox');

    await user.type(input, 'members');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/test/broker/members');
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('hides exchange-gated destinations when the feature is off', async () => {
    mockHasFeature.mockImplementation((f: string) => f !== 'exchange_workflow');
    renderPalette();
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /dashboard/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('option', { name: /match approvals/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /exchanges/i })).not.toBeInTheDocument();
  });

  it('shows a no-results message for a nonsense query', async () => {
    const user = userEvent.setup();
    renderPalette();
    const input = await screen.findByRole('combobox');

    await user.type(input, 'zzzzzz');

    await waitFor(() => {
      expect(screen.getByText(/nothing matches/i)).toBeInTheDocument();
    });
  });
});
