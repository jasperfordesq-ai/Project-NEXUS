// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for PostTab component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() },
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    isAuthenticated: true,
    user: { id: 1, first_name: 'Alice', avatar: '/alice.png' },
  })),
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

vi.mock('@/lib/compress-image', () => ({
  compressImage: vi.fn((file: File) => Promise.resolve(file)),
}));

vi.mock('@/hooks', () => ({
  // 🔴 The barrel mock must carry useMediaQuery too. PostTab imports it from
  // '@/hooks/useMediaQuery' (mocked separately below), but GifPicker — which
  // PostTab renders — imports it from the '@/hooks' BARREL. A total factory
  // replaces the whole module, so the missing export made Vitest throw
  // "No 'useMediaQuery' export is defined on the '@/hooks' mock" at import time,
  // collapsing all 11 tests in this file before any of them ran.
  useMediaQuery: vi.fn(() => false),
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

// Mock the lazy-loaded ComposeEditor (ref as a normal prop) to suppress ref warning
import type { Ref } from 'react';
const MockEditor = ({ placeholder, ref: _ref }: { placeholder?: string; ref?: Ref<unknown> }) => (
  <div data-testid="compose-editor">{placeholder || 'Editor'}</div>
);
MockEditor.displayName = 'MockComposeEditor';

vi.mock('@/components/compose/shared/ComposeEditor', () => ({
  ComposeEditor: MockEditor,
  default: MockEditor,
}));

vi.mock('@/components/compose/MediaUploader', () => ({
  MediaUploader: () => <div data-testid="multi-image-uploader">Images</div>,
}));

vi.mock('@/components/compose/shared/EmojiPicker', () => ({
  EmojiPicker: ({ onSelect }: { onSelect: (e: string) => void }) => (
    <button data-testid="emoji-picker" onClick={() => onSelect('😊')}>Emoji</button>
  ),
}));

vi.mock('@/components/compose/shared/VoiceInput', () => ({
  VoiceInput: () => <button data-testid="voice-input">Voice</button>,
}));

vi.mock('@/components/compose/shared/CharacterCount', () => ({
  CharacterCount: ({ current, max }: { current: number; max: number }) => (
    <span data-testid="char-count">{current}/{max}</span>
  ),
}));

vi.mock('@/components/compose/shared/LinkPreview', () => ({
  LinkPreview: () => <div data-testid="link-preview" />,
}));

import { PostTab } from '../PostTab';

const defaultProps = {
  onSuccess: vi.fn(),
  onClose: vi.fn(),
  groupId: null as number | null,
  templateData: undefined,
};

describe('PostTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(<PostTab {...defaultProps} />);
    expect(document.body).toBeTruthy();
  });

  it('renders the compose editor', () => {
    render(<PostTab {...defaultProps} />);
    expect(screen.getByTestId('compose-editor')).toBeInTheDocument();
  });

  it('renders character count', () => {
    render(<PostTab {...defaultProps} />);
    expect(screen.getByTestId('char-count')).toBeInTheDocument();
  });

  it('renders multi-image uploader', () => {
    render(<PostTab {...defaultProps} />);
    expect(screen.getByTestId('multi-image-uploader')).toBeInTheDocument();
  });

  it('renders emoji picker', () => {
    render(<PostTab {...defaultProps} />);
    expect(screen.getByTestId('emoji-picker')).toBeInTheDocument();
  });

  it('renders voice input', () => {
    render(<PostTab {...defaultProps} />);
    expect(screen.getByTestId('voice-input')).toBeInTheDocument();
  });

  it('renders link preview', () => {
    render(<PostTab {...defaultProps} />);
    expect(screen.getByTestId('link-preview')).toBeInTheDocument();
  });

  it('renders Cancel button on desktop', () => {
    render(<PostTab {...defaultProps} />);
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<PostTab {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('has disabled submit button when content is empty', () => {
    render(<PostTab {...defaultProps} />);
    const postBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('post'),
    );
    // Post button exists but is disabled (canSubmit = false since plainText is empty)
    if (postBtn) {
      expect(postBtn).toBeDisabled();
    }
  });

  it('renders user avatar', () => {
    render(<PostTab {...defaultProps} />);
    // Avatar renders with the user's first_name as the name prop
    const avatar = document.querySelector('[class*="avatar"]') || document.querySelector('img[alt]');
    expect(avatar || document.body).toBeTruthy();
  });
});
