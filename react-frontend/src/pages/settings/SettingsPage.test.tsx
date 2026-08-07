// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for SettingsPage
 *
 * Note: SettingsPage imports 15+ HeroUI components and 15+ Lucide icons.
 * We mock @/components/ui and lucide-react to keep compilation fast.
 */

import React from 'react';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';

const webPushMocks = vi.hoisted(() => ({
  subscribe: vi.fn().mockResolvedValue(true),
  unsubscribe: vi.fn().mockResolvedValue(true),
  refresh: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/hooks/useWebPush', () => ({
  useWebPush: () => ({
    isSupported: true,
    permission: 'granted',
    isSubscribed: true,
    isPending: false,
    error: null,
    ...webPushMocks,
  }),
}));

// ── Mock @/components/ui before any imports ────────────────────────────────────
// SettingsPage imports Modal/ModalContent/… from '@/components/ui/Modal', Tabs/Tab from
// '@/components/ui/Tabs' and useDisclosure from '@/components/ui/useDisclosure' — none of them
// through the barrel. Vitest resolves mocks per specifier, so this factory was dead for all three
// and the real HeroUI components plus the real useDisclosure were what rendered. The factory is a
// full replacement (it spreads nothing from the original), so the same one is registered on every
// specifier the page actually imports; the extra exports a direct path does not use are harmless.
// This is declared as a hoisted function so the vi.mock calls below can reference it.
async function settingsUiMock() {
  const R = await import('react');
  const noop = () => R.createElement(R.Fragment, null);
  const useDisclosureMock = () => {
    const [isOpen, setIsOpen] = R.useState(false);
    const onOpen = R.useCallback(() => setIsOpen(true), []);
    const onClose = R.useCallback(() => setIsOpen(false), []);
    const onOpenChange = R.useCallback((open: boolean) => setIsOpen(open), []);
    return { isOpen, onOpen, onClose, onOpenChange };
  };
  return {
    GlassCard: ({ children, className }: { children: ReactNode; className?: string }) =>
      R.createElement('div', { 'data-testid': 'glass-card', className }, children),
    Button: ({ children, onPress, isDisabled, isLoading, type, ...rest }: Record<string, unknown>) =>
      R.createElement('button', {
        onClick: onPress as () => void,
        disabled: Boolean(isDisabled || isLoading),
        type: (type as string) || 'button',
        'aria-label': rest['aria-label'] as string | undefined,
        'data-testid': rest['data-testid'] as string | undefined,
      }, (isLoading ? 'Loading...' : children) as ReactNode),
    ButtonGroup: ({ children }: { children: ReactNode }) => R.createElement('div', null, children),
    Input: ({ label, value, onChange, placeholder, type, name }: Record<string, unknown>) =>
      R.createElement('input', {
        'aria-label': label as string,
        value: value as string ?? '',
        onChange: onChange as React.ChangeEventHandler<HTMLInputElement>,
        placeholder: placeholder as string,
        type: (type as string) || 'text',
        name: name as string,
      }),
    Textarea: ({ label, value, onChange, placeholder }: Record<string, unknown>) =>
      R.createElement('textarea', {
        'aria-label': label as string,
        value: value as string ?? '',
        onChange: onChange as React.ChangeEventHandler<HTMLTextAreaElement>,
        placeholder: placeholder as string,
      }),
    Switch: ({ children, isSelected, onValueChange }: Record<string, unknown>) =>
      R.createElement('label', null,
        R.createElement('input', {
          type: 'checkbox',
          checked: Boolean(isSelected),
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            (onValueChange as ((v: boolean) => void) | undefined)?.(e.target.checked),
        }),
        children as ReactNode,
      ),
    Avatar: noop,
    Tabs: ({ children, selectedKey, onSelectionChange }: Record<string, unknown>) =>
      R.createElement('div', { role: 'tablist' },
        R.Children.map(children as ReactNode, (child) => {
          if (!R.isValidElement(child)) return child;
          return R.cloneElement(child, {
            onSelect: () => (onSelectionChange as ((key: React.Key) => void) | undefined)?.(child.key ?? ''),
            isSelected: child.key === selectedKey,
          } as Record<string, unknown>);
        }),
      ),
    Tab: ({ children, title, onSelect, isSelected }: Record<string, unknown>) =>
      R.createElement('button', { role: 'tab', onClick: onSelect, 'aria-selected': Boolean(isSelected) },
        R.createElement('span', null, title as ReactNode),
        children as ReactNode,
      ),
    Select: ({ children, label }: Record<string, unknown>) =>
      R.createElement('div', { 'aria-label': label as string }, children as ReactNode),
    SelectItem: ({ children }: { children: ReactNode }) => R.createElement('div', null, children),
    Modal: ({ children, isOpen }: Record<string, unknown>) =>
      isOpen ? R.createElement('div', { role: 'dialog' }, children as ReactNode) : null,
    ModalContent: ({ children }: { children: ((onClose: () => void) => ReactNode) | ReactNode }) =>
      R.createElement('div', null, typeof children === 'function' ? (children as (c: () => void) => ReactNode)(vi.fn()) : children as ReactNode),
    ModalHeader: ({ children }: { children: ReactNode }) => R.createElement('div', null, children),
    ModalBody: ({ children }: { children: ReactNode }) => R.createElement('div', null, children),
    ModalFooter: ({ children }: { children: ReactNode }) => R.createElement('div', null, children),
    Chip: ({ children }: { children: ReactNode }) => R.createElement('span', null, children),
    ToggleButtonGroup: ({ children, ...rest }: Record<string, unknown>) =>
      R.createElement('div', { role: 'radiogroup', 'aria-label': rest['aria-label'] as string | undefined }, children as ReactNode),
    ToggleButton: ({ children }: { children: ReactNode }) =>
      R.createElement('button', { type: 'button' }, children),
    Spinner: noop,
    useDisclosure: useDisclosureMock,
  };
}

vi.mock('@/components/ui', settingsUiMock);
vi.mock('@/components/ui/Modal', settingsUiMock);
vi.mock('@/components/ui/Tabs', settingsUiMock);
vi.mock('@/components/ui/useDisclosure', settingsUiMock);
// The tabs import UI components by direct path, so a barrel-only override is
// dead for them. SafeguardingTab and ProfileTab both take Textarea this way.
vi.mock('@/components/ui/Textarea', settingsUiMock);
// Same reason: SafeguardingTab's support-level pickers became HeroUI Selects
// (2026-08-07) imported by direct path, which killed the barrel Select and
// SelectItem overrides here. Mock the direct path rather than switching the
// source to a barrel import — that would fight the file's own convention.
vi.mock('@/components/ui/Select', settingsUiMock);

// ── Mock lucide-react icons ───────────────────────────────────────────────────
vi.mock('lucide-react', () => {
  const Icon = () => null;
  return {
    User: Icon, Bell: Icon, Shield: Icon, Save: Icon, Camera: Icon,
    Mail: Icon, Lock: Icon, Smartphone: Icon, Key: Icon, LogOut: Icon,
    Trash2: Icon, Settings: Icon, AlertTriangle: Icon, Eye: Icon, EyeOff: Icon,
    Phone: Icon, Building2: Icon, Search: Icon, MessageSquare: Icon, Trophy: Icon,
    CreditCard: Icon, Download: Icon, FileText: Icon, RefreshCw: Icon, Monitor: Icon,
    QrCode: Icon, ShieldCheck: Icon, ShieldOff: Icon, Copy: Icon, CheckCircle: Icon,
    Info: Icon, FileCheck: Icon, Upload: Icon, PenLine: Icon, Ban: Icon, Scale: Icon,
    Sparkles: Icon, Calendar: Icon, Users: Icon, Globe: Icon, ChevronRight: Icon,
  };
});

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: {} }),
    post: vi.fn().mockResolvedValue({ success: true }),
    put: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
    upload: vi.fn().mockResolvedValue({ success: true, data: { avatar_url: '/new-avatar.png' } }),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

// Stable references — CRITICAL: useAuth/useTenant/useToast must return the SAME object
// reference on every call to prevent useEffect dependency loops.
// SettingsPage's main useEffect has [user, ...loadFns] deps — if user changes reference
// on each render, the effect fires infinitely.
vi.mock('@/contexts', () => {
  const mockUser = {
    id: 1,
    first_name: 'Test',
    last_name: 'User',
    name: 'Test User',
    phone: '123456789',
    tagline: 'Hello world',
    bio: 'A test bio',
    location: 'Dublin',
    avatar: null,
    profile_type: 'individual',
    organization_name: '',
    has_2fa_enabled: false,
  };
  const mockLogout = vi.fn();
  const mockRefreshUser = vi.fn();
  const mockAuthResult = { user: mockUser, isAuthenticated: true, logout: mockLogout, refreshUser: mockRefreshUser };

  const mockTenantResult = {
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  };

  const mockToastSuccess = vi.fn();
  const mockToastError = vi.fn();
  const mockToastInfo = vi.fn();
  const mockToastWarning = vi.fn();
  const mockToastResult = { success: mockToastSuccess, error: mockToastError, info: mockToastInfo, warning: mockToastWarning };

  return {
    useAuth: vi.fn(() => mockAuthResult),
    useTenant: vi.fn(() => mockTenantResult),
    useToast: vi.fn(() => mockToastResult),
    useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
    useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
    usePusher: () => ({ channel: null, isConnected: false }),
    usePusherOptional: () => null,
    useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
    readStoredConsent: () => null,
    useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
    useFeature: vi.fn(() => true),
    useModule: vi.fn(() => true),
  };
});

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...actual,
    resolveAvatarUrl: vi.fn((url: string) => url || '/default-avatar.png'),
    formatRelativeTime: vi.fn(() => '2 hours ago'),
  };
});

vi.mock('@/components/location', () => ({
  PlaceAutocompleteInput: ({ label, placeholder, value, onChange }: {
    label: string;
    placeholder: string;
    value: string;
    onChange: (val: string) => void;
  }) => (
    <input
      data-testid="place-autocomplete"
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock('@/components/location/PlaceAutocompleteInput', () => ({
  PlaceAutocompleteInput: ({ label, placeholder, value, onChange }: {
    label: string;
    placeholder: string;
    value: string;
    onChange: (val: string) => void;
  }) => (
    <input
      data-testid="place-autocomplete"
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

// Stable t function — defined once in factory scope to prevent identity change on re-render.
// SettingsPage has loadSessions with [t] as useCallback dep → unstable t causes infinite loop.
vi.mock('react-i18next', () => {
  const settingsTranslations: Record<string, string> = {
    'header.title': 'Settings',
    'header.subtitle': 'Manage your account preferences',
    'tabs.profile': 'Profile',
    'tabs.notifications': 'Notifications',
    'tabs.privacy': 'Privacy',
    'tabs.security': 'Security',
    'tabs.skills': 'Skills',
    'tabs.availability': 'Availability',
    'tabs.linked': 'Linked Accounts',
    'tabs.connected_accounts': 'Connected Accounts',
    'tabs.safeguarding': 'Safeguarding',
    'tabs.translation': 'Translation',
    'profile.section_title': 'Profile Information',
    'profile.first_name': 'First Name',
    'profile.last_name': 'Last Name',
    'save_changes': 'Save Changes',
    'unsaved_changes.title': 'Unsaved Changes',
    'unsaved_changes.message': 'Unsaved changes will be lost.',
    'unsaved_changes.leave': 'Leave Anyway',
    'unsaved_changes.stay': 'Stay',
    'privacy_sections.title': 'Privacy Settings',
    'privacy_load_failed': 'Failed to load privacy settings',
  };
  const stableTFn = (key: string, opts?: Record<string, unknown> | string): string => {
    if (typeof opts === 'object' && opts !== null && 'fallbackValue' in opts) {
      return opts.fallbackValue as string;
    }
    return settingsTranslations[key] ?? key;
  };
  const stableI18n = { language: 'en', changeLanguage: () => Promise.resolve() };
  return {
    initReactI18next: { type: '3rdParty', init: vi.fn() },
    useTranslation: () => ({ t: stableTFn, i18n: stableI18n }),
  };
});

vi.mock('dompurify', () => ({
  default: {
    addHook: vi.fn(),
    sanitize: vi.fn((html: string) => html),
  },
}));

vi.mock('@/components/security/BiometricSettings', () => ({
  BiometricSettings: () => null,
}));

vi.mock('@/components/skills/SkillSelector', () => ({
  SkillSelector: () => null,
}));

vi.mock('@/components/availability/AvailabilityGrid', () => ({
  AvailabilityGrid: () => null,
}));

vi.mock('@/components/subaccounts/SubAccountsManager', () => ({
  SubAccountsManager: () => null,
}));

vi.mock('@/components/LanguageSwitcher', () => ({
  LanguageSwitcher: () => null,
}));

// Mock framer-motion — IMPORTANT: use a stable MotionDiv component, NOT a Proxy that
// creates a new component class on each property access. React tracks component identity;
// a new class per render causes unmount/remount cycles → infinite effect loops.
vi.mock('@/lib/motion', async () => {
  const R = await import('react');
  const MOTION_PROPS = new Set(['variants', 'initial', 'animate', 'exit', 'layout', 'whileHover', 'whileTap', 'transition', 'whileInView', 'viewport', 'layoutId']);
  const MotionDiv = R.forwardRef(({ children, ...props }: Record<string, unknown>, ref: R.Ref<HTMLDivElement>) => {
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      if (!MOTION_PROPS.has(k)) safe[k] = v;
    }
    return R.createElement('div', { ...safe, ref }, children as R.ReactNode);
  });
  MotionDiv.displayName = 'MotionDiv';
  return {
    motion: { div: MotionDiv, section: MotionDiv, span: MotionDiv, p: MotionDiv, ul: MotionDiv, li: MotionDiv },
    AnimatePresence: ({ children }: { children: R.ReactNode }) => R.createElement(R.Fragment, null, children),
  };
});

import { SettingsPage } from './SettingsPage';
import { api } from '@/lib/api';

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      {children}
    </MemoryRouter>
  );
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/v2/users/me/notifications')) {
        return Promise.resolve({
          success: true,
          data: {
            email_messages: true,
            email_listings: true,
            email_digest: false,
            email_connections: true,
            email_transactions: true,
            email_reviews: true,
            email_gamification: false,
            push_enabled: true,
          },
        });
      }
      if (url.includes('/v2/users/me/preferences')) {
        return Promise.resolve({
          success: true,
          data: {
            privacy: {
              privacy_profile: 'members',
              privacy_search: true,
            },
          },
        });
      }
      if (url.includes('/v2/users/me/match-preferences')) {
        return Promise.resolve({
          success: true,
          data: {
            notification_frequency: 'monthly',
            notify_hot_matches: true,
            notify_mutual_matches: true,
          },
        });
      }
      if (url.includes('/v2/users/me/consent')) {
        return Promise.resolve({ success: true, data: [] });
      }
      if (url.includes('/v2/auth/2fa/status')) {
        return Promise.resolve({
          success: true,
          data: { enabled: false, backup_codes_remaining: 0 },
        });
      }
      if (url.includes('/v2/notifications/settings')) {
        return Promise.resolve({
          success: true,
          data: { global_frequency: 'off', per_group: [], per_thread: [] },
        });
      }
      if (url.includes('/v2/users/me/sessions')) {
        return Promise.resolve({ success: true, data: [] });
      }
      return Promise.resolve({ success: true, data: {} });
    });
  });

  it('renders the page heading and description', () => {
    render(<SettingsPage />, { wrapper: Wrapper });
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Manage your account preferences')).toBeInTheDocument();
  });

  it('shows tab navigation with Profile, Notifications, Privacy, Security', () => {
    render(<SettingsPage />, { wrapper: Wrapper });
    expect(screen.getByRole('tab', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Privacy' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Security' })).toBeInTheDocument();
  });

  it('shows Profile Information section by default', () => {
    render(<SettingsPage />, { wrapper: Wrapper });
    expect(screen.getByText('Profile Information')).toBeInTheDocument();
  });

  it('shows profile form fields', () => {
    render(<SettingsPage />, { wrapper: Wrapper });
    expect(screen.getByLabelText('First Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Last Name')).toBeInTheDocument();
  });

  it('shows Save Changes button on profile tab', () => {
    render(<SettingsPage />, { wrapper: Wrapper });
    expect(screen.getByText('Save Changes')).toBeInTheDocument();
  });

  it('populates form with user data', () => {
    render(<SettingsPage />, { wrapper: Wrapper });
    const firstNameInput = screen.getByLabelText('First Name') as HTMLInputElement;
    expect(firstNameInput.value).toBe('Test');
    const lastNameInput = screen.getByLabelText('Last Name') as HTMLInputElement;
    expect(lastNameInput.value).toBe('User');
  });

  it('loads tab-specific APIs only when that tab is opened', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />, { wrapper: Wrapper });

    expect(vi.mocked(api.get).mock.calls.some(([url]) => String(url).includes('/users/me/notifications'))).toBe(false);
    expect(vi.mocked(api.get).mock.calls.some(([url]) => String(url).includes('/users/me/preferences'))).toBe(false);
    expect(vi.mocked(api.get).mock.calls.some(([url]) => String(url).includes('/users/me/sessions'))).toBe(false);

    await user.click(screen.getByRole('tab', { name: 'Notifications' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/v2/users/me/notifications'));
    expect(vi.mocked(api.get).mock.calls.some(([url]) => String(url).includes('/users/me/preferences'))).toBe(false);
    expect(vi.mocked(api.get).mock.calls.some(([url]) => String(url).includes('/users/me/sessions'))).toBe(false);
  });

  it('restores the server-backed profile snapshot when changes are discarded', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />, { wrapper: Wrapper });

    const firstName = screen.getByLabelText('First Name') as HTMLInputElement;
    await user.clear(firstName);
    await user.type(firstName, 'Changed');
    expect(firstName.value).toBe('Changed');

    await user.click(screen.getByRole('tab', { name: 'Notifications' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByText('Leave Anyway'));
    await user.click(screen.getByRole('tab', { name: 'Profile' }));

    expect((screen.getByLabelText('First Name') as HTMLInputElement).value).toBe('Test');
  });

  it('reconciles the browser push subscription when notification changes are discarded', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />, { wrapper: Wrapper });

    await user.click(screen.getByRole('tab', { name: 'Notifications' }));
    const pushToggle = await screen.findByRole('switch', { name: 'notification_prefs.enable_push' });
    await user.click(pushToggle);
    await waitFor(() => expect(webPushMocks.unsubscribe).toHaveBeenCalled());

    await user.click(screen.getByRole('tab', { name: 'Profile' }));
    await user.click(screen.getByText('Leave Anyway'));

    await waitFor(() => expect(webPushMocks.subscribe).toHaveBeenCalled());
  });

  it('saves all notification groups through the atomic endpoint', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />, { wrapper: Wrapper });

    await user.click(screen.getByRole('tab', { name: 'Notifications' }));
    await waitFor(() => expect(screen.getByText('save_preferences')).toBeInTheDocument());
    await user.click(screen.getByText('save_preferences'));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      '/v2/users/me/notification-settings',
      expect.objectContaining({
        notifications: expect.any(Object),
        match_preferences: expect.objectContaining({ notification_frequency: 'monthly' }),
        digest_frequency: 'off',
      }),
    ));
  });

  it('keeps the visible tab synchronized with browser history', async () => {
    const user = userEvent.setup();
    function BackButton() {
      const go = useNavigate();
      return <button onClick={() => go(-1)}>Go back</button>;
    }

    render(
      <MemoryRouter
        initialEntries={['/settings?tab=privacy', '/settings?tab=security']}
        initialIndex={1}
      >
        <BackButton />
        <SettingsPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByText('Go back'));
    await waitFor(() => expect(screen.getByText('Privacy Settings')).toBeInTheDocument());
  });
});
