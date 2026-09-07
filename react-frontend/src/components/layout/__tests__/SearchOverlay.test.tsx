// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * HeroUI Modal integration tests for the SearchOverlay command palette.
 * Async search behavior lives in the adjacent SearchOverlay.test.tsx suite.
 */

import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import searchOverlaySource from '../SearchOverlay.tsx?raw';

// Mock navigate
const mockNavigate = vi.fn();
const mockHasFeature = vi.fn(() => true);
const mockToggleTheme = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock i18n
const i18nMap: Record<string, string> = {
  'search.placeholder': 'Search...',
  'search.suggestions': 'Suggestions',
  'search.searching': 'Searching...',
  'search.actions': 'Actions',
  'search.quick_links': 'Quick Links',
  'search.clear': 'Clear',
  'search.type_listing': 'Listing',
  'search.type_member': 'Member',
  'search.type_event': 'Event',
  'search.type_group': 'Group',
  'nav.listings': 'Listings',
  'nav.members': 'Members',
  'nav.events': 'Events',
  'support.help_center': 'Help',
  'accessibility.close': 'Close (ESC)',
  'aria.clear': 'Clear search',
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      if (key === 'aria.search_results' && typeof options === 'object') {
        return `${options.count ?? 0} results available`;
      }

      return i18nMap[key] ?? (typeof options === 'string' ? options : key);
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

// Mock contexts
vi.mock('@/contexts', () => ({
  useTenant: () => ({
    tenantPath: (p: string) => p,
    hasFeature: mockHasFeature,
    hasModule: () => true,
  }),
  useAuth: () => ({
    isAuthenticated: false,
  }),
  useTheme: () => ({
    resolvedTheme: 'light',
    toggleTheme: mockToggleTheme,
  }),

  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

// Mock API
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: {} }),
  },
}));

import { SearchOverlay } from '../SearchOverlay';

function renderOverlay(isOpen = true, onClose = vi.fn()) {
  return { ...render(<SearchOverlay isOpen={isOpen} onClose={onClose} />), onClose };
}

function SearchOverlayHarness() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button onClick={() => setIsOpen(true)}>Open search</button>
      <SearchOverlay isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}

describe('SearchOverlay — HeroUI Modal integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasFeature.mockReturnValue(true);
  });

  it('renders nothing when closed', () => {
    const { container } = renderOverlay(false);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders through the HeroUI Modal anatomy as a named modal dialog', () => {
    renderOverlay();
    const dialog = screen.getByRole('dialog', { name: 'Search...' });

    expect(dialog).toHaveAttribute('data-slot', 'modal-dialog');
    expect(document.querySelector('[data-slot="modal-backdrop"]')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="modal-container"]')).toBeInTheDocument();
    expect(screen.getByText('ESC')).toBeInTheDocument();
  });

  it('autofocuses the combobox and lets HeroUI dismiss on Escape', async () => {
    const onClose = vi.fn();
    renderOverlay(true, onClose);
    const input = screen.getByRole('combobox');

    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('keeps HeroUI backdrop dismissal enabled', async () => {
    const onClose = vi.fn();
    renderOverlay(true, onClose);
    const backdrop = document.querySelector<HTMLElement>('[data-slot="modal-backdrop"]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('restores focus to the opener after Escape closes the controlled modal', async () => {
    render(<SearchOverlayHarness />);
    const opener = screen.getByRole('button', { name: 'Open search' });
    opener.focus();
    fireEvent.click(opener);
    const input = screen.getByRole('combobox');
    expect(input).toHaveFocus();

    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(opener).toHaveFocus();
    });
  });

  it('dismisses through the explicit translated close action', () => {
    const onClose = vi.fn();
    renderOverlay(true, onClose);
    fireEvent.click(screen.getByLabelText('Close (ESC)'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('implements input-owned listbox navigation without moving DOM focus', () => {
    renderOverlay();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '>' } });
    const options = screen.getAllByRole('option');
    const listbox = screen.getByRole('listbox', { name: 'Actions' });

    expect(input).toHaveAttribute('aria-controls', listbox.id);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).not.toHaveAttribute('aria-activedescendant');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', options[0]?.id);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveFocus();

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input).toHaveAttribute('aria-activedescendant', options.at(-1)?.id);
    expect(options.at(-1)).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveFocus();
  });

  it('activates the active command with Enter', () => {
    const onClose = vi.fn();
    renderOverlay(true, onClose);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '>' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockToggleTheme).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders the default quick links and respects the connections feature gate', () => {
    const { rerender } = renderOverlay();
    expect(screen.getByText('Listings')).toBeInTheDocument();
    expect(screen.getByText('Members')).toBeInTheDocument();
    expect(screen.getByText('Events')).toBeInTheDocument();
    expect(screen.getByText('Help')).toBeInTheDocument();

    mockHasFeature.mockImplementation((feature: string) => feature !== 'connections');
    rerender(<SearchOverlay isOpen onClose={vi.fn()} />);
    expect(screen.queryByText('Members')).toBeNull();
  });

  it('delegates portal, focus, Escape, and scroll-lock behavior to Modal', () => {
    expect(searchOverlaySource).toContain('<Modal');
    expect(searchOverlaySource).toContain('isDismissable');
    expect(searchOverlaySource).not.toContain('createPortal');
    expect(searchOverlaySource).not.toContain('FocusScope');
    expect(searchOverlaySource).not.toContain('document.addEventListener');
    expect(searchOverlaySource).not.toContain('document.body.style.overflow');
  });
});
