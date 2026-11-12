// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for GoalTab component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: true, user: { id: 1, first_name: 'Alice', avatar: '/alice.png' } })),
  useToast: vi.fn(() => mockToast),
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useTenant: () => ({ tenant: { id: 2, name: 'Test', slug: 'test', tagline: null }, branding: { name: 'Test', logo_url: null }, tenantSlug: 'test', tenantPath: (p: string) => '/test' + p, isLoading: false, hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true) }),
}));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url: string | undefined) => url || '/default-avatar.png'),
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/hooks', () => ({
  useDraftPersistence: vi.fn((_key: string, fallbackValue: unknown) => {
    const state = { ...(fallbackValue as Record<string, unknown>) };
    const setState = vi.fn((updater: ((s: typeof state) => typeof state) | typeof state) => {
      if (typeof updater === 'function') {
        Object.assign(state, updater(state));
      } else {
        Object.assign(state, updater);
      }
    });
    const clearState = vi.fn();
    return [state, setState, clearState];
  }),
}));

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn(() => false),
}));

vi.mock('@/components/compose/ComposeSubmitContext', () => ({
  useComposeSubmit: vi.fn(() => ({
    registration: null,
    register: vi.fn(),
    unregister: vi.fn(),
  })),
}));

vi.mock('@/components/compose/shared/EmojiPicker', () => ({
  EmojiPicker: ({ onSelect }: { onSelect: (e: string) => void }) => (
    <button data-testid="emoji-picker" onClick={() => onSelect('😊')}>Emoji</button>
  ),
}));

vi.mock('@/components/compose/shared/CharacterCount', () => ({
  CharacterCount: ({ current, max }: { current: number; max: number }) => (
    <span data-testid="char-count">{current}/{max}</span>
  ),
}));

import { GoalTab } from '../GoalTab';

const defaultProps = {
  onSuccess: vi.fn(),
  onClose: vi.fn(),
  groupId: null as number | null,
  templateData: undefined,
};

describe('GoalTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(<GoalTab {...defaultProps} />);
    expect(document.body).toBeTruthy();
  });

  it('renders title input', () => {
    render(<GoalTab {...defaultProps} />);
    const titleInput = screen.getByRole('textbox', { name: /title/i });
    expect(titleInput).toBeInTheDocument();
  });

  it('renders description textarea', () => {
    render(<GoalTab {...defaultProps} />);
    const descInput = screen.getByRole('textbox', { name: /description/i });
    expect(descInput).toBeInTheDocument();
  });

  it('renders target value input', () => {
    render(<GoalTab {...defaultProps} />);
    const targetInput = screen.getByRole('spinbutton', { name: /target/i });
    expect(targetInput).toBeInTheDocument();
  });

  it('renders make public switch', () => {
    render(<GoalTab {...defaultProps} />);
    const toggle = screen.getByRole('switch', { name: /public/i });
    expect(toggle).toBeInTheDocument();
  });

  it('renders character count', () => {
    render(<GoalTab {...defaultProps} />);
    expect(screen.getByTestId('char-count')).toBeInTheDocument();
  });

  it('renders emoji picker', () => {
    render(<GoalTab {...defaultProps} />);
    expect(screen.getByTestId('emoji-picker')).toBeInTheDocument();
  });

  it('renders Cancel button on desktop', () => {
    render(<GoalTab {...defaultProps} />);
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<GoalTab {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('has disabled submit button when title is empty', () => {
    render(<GoalTab {...defaultProps} />);
    const createBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('goal'),
    );
    expect(createBtn).toBeDefined();
    expect(createBtn).toBeDisabled();
  });

  // Warmth phase 5: the button's blend ended on a fixed pink.
  it('paints the create button in the community colour', () => {
    render(<GoalTab {...defaultProps} />);
    const createBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('goal'),
    );
    expect(createBtn?.className).toContain('from-accent-strong');
    expect(createBtn?.className).toContain('to-accent-strong-end');
    expect(createBtn?.className).not.toMatch(/pink-/);
  });
});
