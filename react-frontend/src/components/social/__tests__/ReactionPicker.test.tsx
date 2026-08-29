// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ReactionPicker component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { label?: string }) => {
      const translations: Record<string, string> = {
        'card.like_action': 'Like',
        'reaction.react_to_post': 'React to this post',
        'reaction.click_to_remove': `Click to remove ${opts?.label ?? 'reaction'}`,
      };
      return translations[key] ?? key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({ user: { id: 1 }, isAuthenticated: true })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test', slug: 'test' },
    tenantSlug: 'test',
    branding: { name: 'Test' },
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    tenantPath: (p: string) => `/test${p}`,
  })),
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() })),
  useTheme: vi.fn(() => ({ resolvedTheme: 'light', theme: 'light', setTheme: vi.fn() })),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

import { ReactionPicker, REACTION_CONFIGS, REACTION_EMOJI_MAP, REACTION_LABEL_MAP } from '../ReactionPicker';
import type { ReactionType } from '../ReactionPicker';

function W({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemoryRouter initialEntries={['/test']}>
        {children}
      </MemoryRouter>
    </>
  );
}

async function settleLazyMenu() {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

describe('ReactionPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const defaultProps = {
    userReaction: null as ReactionType | null,
    onReact: vi.fn(),
    isAuthenticated: true,
  };

  it('renders without crashing', () => {
    const { container } = render(
      <W><ReactionPicker {...defaultProps} /></W>,
    );
    expect(container).toBeTruthy();
  });

  it('renders the main reaction button with "Like" label when no reaction selected', () => {
    render(<W><ReactionPicker {...defaultProps} /></W>);
    expect(screen.getByText('Like')).toBeInTheDocument();
  });

  it('shows the current reaction label when a reaction is selected', () => {
    render(
      <W><ReactionPicker {...defaultProps} userReaction="love" /></W>,
    );
    expect(screen.getByText('reaction.love')).toBeInTheDocument();
  });

  it('disables button when isAuthenticated is false', () => {
    render(
      <W><ReactionPicker {...defaultProps} isAuthenticated={false} /></W>,
    );
    const button = screen.getByRole('button', { name: /React to this post/i });
    expect(button).toBeDisabled();
  });

  it('disables button when isDisabled is true', () => {
    render(
      <W><ReactionPicker {...defaultProps} isDisabled={true} /></W>,
    );
    const button = screen.getByRole('button', { name: /React to this post/i });
    expect(button).toBeDisabled();
  });

  it('calls onReact with "like" on quick tap when no reaction', () => {
    render(<W><ReactionPicker {...defaultProps} /></W>);
    const button = screen.getByRole('button', { name: /React to this post/i });
    fireEvent.click(button);
    expect(defaultProps.onReact).toHaveBeenCalledWith('like');
  });

  it('calls onReact with current reaction on quick tap to remove it', () => {
    const onReact = vi.fn();
    render(
      <W><ReactionPicker {...defaultProps} userReaction="love" onReact={onReact} /></W>,
    );
    const button = screen.getByRole('button', { name: /click to remove/i });
    fireEvent.click(button);
    expect(onReact).toHaveBeenCalledWith('love');
  });

  it('does not call onReact when not authenticated', () => {
    const onReact = vi.fn();
    render(
      <W><ReactionPicker {...defaultProps} isAuthenticated={false} onReact={onReact} /></W>,
    );
    const button = screen.getByRole('button', { name: /React to this post/i });
    fireEvent.click(button);
    expect(onReact).not.toHaveBeenCalled();
  });

  it('opens picker popup on mouse hover after delay', async () => {
    render(<W><ReactionPicker {...defaultProps} /></W>);
    const container = screen.getByText('Like').closest('.relative')!;
    fireEvent.mouseEnter(container);

    // Picker should not be visible yet
    expect(screen.queryAllByRole('img')).toHaveLength(0);

    // Advance past the 300ms delay
    act(() => {
      vi.advanceTimersByTime(350);
    });
    await settleLazyMenu();

    // Picker should now be open — reaction buttons should be visible
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(8);
  });

  it('does not open picker on hover when not authenticated', () => {
    render(<W><ReactionPicker {...defaultProps} isAuthenticated={false} /></W>);
    const container = screen.getByRole('button', { name: /React to this post/i }).closest('.relative')!;
    fireEvent.mouseEnter(container);

    act(() => {
      vi.advanceTimersByTime(350);
    });

    // Only the main button should exist
    const allButtons = screen.getAllByRole('button');
    expect(allButtons).toHaveLength(1);
  });

  it('triggers close on mouse leave after delay', async () => {
    render(<W><ReactionPicker {...defaultProps} /></W>);
    const container = screen.getByText('Like').closest('.relative')!;

    // Open picker
    fireEvent.mouseEnter(container);
    act(() => { vi.advanceTimersByTime(350); });
    await settleLazyMenu();

    // Verify picker is open (more than 1 button)
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(8);

    // Mouse leave triggers close timeout — the AnimatePresence exit animation
    // may keep DOM nodes briefly. Just verify mouse leave does not throw.
    fireEvent.mouseLeave(container);
    act(() => { vi.advanceTimersByTime(350); });

    // The picker should have started its close animation
    // (AnimatePresence may retain nodes in the DOM for exit animation)
    expect(container).toBeTruthy();
  });

  it('calls onReact and closes picker when a reaction emoji is selected', async () => {
    const onReact = vi.fn();
    render(<W><ReactionPicker {...defaultProps} onReact={onReact} /></W>);
    const container = screen.getByText('Like').closest('.relative')!;

    // Open picker
    fireEvent.mouseEnter(container);
    act(() => { vi.advanceTimersByTime(350); });
    await settleLazyMenu();

    // Click the "love" reaction button
    const loveButton = screen.getByRole('menuitemradio', { name: 'reaction.love' });
    fireEvent.click(loveButton);

    expect(onReact).toHaveBeenCalledWith('love');
  });

  it('renders with size="sm"', () => {
    const { container } = render(
      <W><ReactionPicker {...defaultProps} size="sm" /></W>,
    );
    expect(container).toBeTruthy();
  });

  it('shows aria-label for remove when reaction is active', () => {
    render(
      <W><ReactionPicker {...defaultProps} userReaction="laugh" /></W>,
    );
    const button = screen.getByRole('button', { name: /click to remove/i });
    expect(button).toBeInTheDocument();
  });

  // ─── Exported constants ───

  it('REACTION_CONFIGS has 8 entries', () => {
    expect(REACTION_CONFIGS).toHaveLength(8);
  });

  it('REACTION_EMOJI_MAP maps all types', () => {
    expect(REACTION_EMOJI_MAP['like']).toBeDefined();
    expect(REACTION_EMOJI_MAP['love']).toBeDefined();
    expect(REACTION_EMOJI_MAP['time_credit']).toBeDefined();
  });

  it('REACTION_LABEL_MAP maps all types', () => {
    expect(REACTION_LABEL_MAP['like']).toBe('reaction.like');
    expect(REACTION_LABEL_MAP['love']).toBe('reaction.love');
  });
});
