// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AWID re-audit R3 (30 Oct 2026, independent probe by Codex, kept as a
 * regression): switching auto-translate off cleared the translations but left
 * the running batch going, so a late reply brought a translation back while the
 * switch was off.
 */

import { fireEvent, render, screen, waitFor } from '@/test/test-utils';
import { act, type FormEventHandler } from 'react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const stableMocks = vi.hoisted(() => ({
  hasFeature: vi.fn(() => true),
  hasModule: vi.fn(() => true),
  navigate: vi.fn(),
  refreshCounts: vi.fn(() => Promise.resolve()),
  setSearchParams: vi.fn(),
  showToast: vi.fn(),
  toastError: vi.fn(),
  tenantPath: vi.fn((p: string) => `/t/test${p}`),
  t: vi.fn((key: string) => key),
  tenant: { id: 2, translation: { enabled: true, auto_translate_default: false, provider: 'openai' } } as Record<string, unknown>,
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  resolveAvatarUrl: (url: string | null) => url ?? '',
  resolveAssetUrl: (url: string) => url,
  formatDate: (value: string) => new Date(value).toDateString(),
}));

vi.mock('@/contexts', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Alice' }, isAuthenticated: true }),
  useToast: () => ({ showToast: stableMocks.showToast, error: stableMocks.toastError, success: vi.fn(), info: vi.fn() }),
  useTenant: () => ({
    tenantPath: stableMocks.tenantPath,
    hasFeature: stableMocks.hasFeature,
    hasModule: stableMocks.hasModule,
    tenantSlug: 'test',
    tenant: stableMocks.tenant,
  }),
  usePusherOptional: () => null,
  usePresenceOptional: () => null,

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn(), refreshCounts: stableMocks.refreshCounts }),
  usePusher: () => ({ channel: null, isConnected: false }),
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

// ConversationPage reads usePusherOptional / usePresenceOptional from their DIRECT
// paths, so the `usePusherOptional` / `usePresenceOptional` keys on the '@/contexts'
// factory above can never be reached. Mock the direct modules — both are provider
// infrastructure (a Pusher websocket, presence polling) that a page-level test has
// no business booting, and both pull AuthContext + the API client in at module scope.
// Total factories, not importOriginal spreads, for exactly that reason.
vi.mock('@/contexts/PusherContext', () => ({
  usePusherOptional: () => null,
  usePusher: () => ({ channel: null, isConnected: false }),
}));

vi.mock('@/contexts/PresenceContext', () => ({
  usePresenceOptional: () => null,
  usePresence: () => ({
    fetchPresence: vi.fn(),
    getPresence: vi.fn(() => null),
  }),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: stableMocks.t,
    i18n: { changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/lib/motion', () => ({
  motion: new Proxy({}, {
    get: (_: object, prop: string) => {
      const { createElement, forwardRef } = require('react');
      return forwardRef(({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>, ref: React.Ref<unknown>) =>
        createElement(prop as string, { ...props, ref }, children)
      );
    },
  }),
  AnimatePresence: ({ children }: React.PropsWithChildren) => children,
}));

// NOTE: no `vi.mock('@/components/ui', ...)` here on purpose. ConversationPage
// imports Avatar/Badge/Button/Chip/Dropdown/GlassCard/Modal/Popover/SearchField/
// Skeleton/Spinner/Tooltip from their DIRECT paths, so a barrel override would
// never be reached. These tests already drive the real widgets (e.g. the overflow
// Dropdown only mounts its items once its trigger is pressed).

vi.mock('@/components/feedback', () => ({
  LoadingScreen: () => <div data-testid="loading-screen">Loading...</div>,
}));

vi.mock('@/components/messages/MessageContextCard', () => ({
  MessageContextCard: () => <div data-testid="context-card" />,
}));

vi.mock('@/components/verification/VerificationBadge', () => ({
  VerificationBadgeRow: () => <div data-testid="verification-badge-row" />,
  useVerificationBadges: () => ({
    badges: [{ type: 'id_verified', label: 'ID Verified' }],
    isLoaded: true,
  }),
}));

vi.mock('./components/MessageBubble', () => ({
  MessageBubble: ({ message, autoTranslatedText }: { message: { content: string }; autoTranslatedText?: string }) => (
    <div data-testid="message-bubble">{autoTranslatedText || message.content}</div>
  ),
}));

vi.mock('./components/MessageInputArea', () => ({
  MessageInputArea: ({ newMessage, onNewMessageChange, onSendMessage, safeguardingPolicyStatus }: {
    newMessage: string;
    onNewMessageChange: (value: string) => void;
    onSendMessage: FormEventHandler<HTMLFormElement>;
    safeguardingPolicyStatus?: 'allow' | 'deny' | 'unavailable';
  }) => (
    // Mirror the real component: when interaction is blocked (safeguarding), the
    // composer is replaced rather than rendered, so the member cannot type.
    safeguardingPolicyStatus !== 'allow' ? (
      <div data-testid="composer-blocked" />
    ) : (
      <form data-testid="message-input-area" onSubmit={onSendMessage}>
        <input
          aria-label="mock-message-input"
          value={newMessage}
          onChange={(event) => onNewMessageChange(event.target.value)}
        />
        <button type="submit">mock-send</button>
      </form>
    )
  ),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: '42' }),
    useSearchParams: () => [new URLSearchParams(), stableMocks.setSearchParams],
    useNavigate: () => stableMocks.navigate,
  };
});

import { api } from '@/lib/api';
import { ConversationPage } from './ConversationPage';

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

// API response structure: data = messages[], meta.conversation = ConversationMeta
const mockMessages = [
  { id: 1, body: 'Hello Bob!', content: 'Hello Bob!', sender_id: 1, is_own: true, created_at: '2026-01-01T10:00:00Z', is_read: true, is_deleted: false, is_edited: false, is_voice: false, attachments: [], reactions: {} },
  { id: 2, body: 'Hi Alice!', content: 'Hi Alice!', sender_id: 20, is_own: false, created_at: '2026-01-01T10:01:00Z', is_read: true, is_deleted: false, is_edited: false, is_voice: false, attachments: [], reactions: {} },
];

const mockConversationResponse = {
  success: true,
  data: mockMessages,
  meta: {
    conversation: {
      id: 42,
      other_user: { id: 20, name: 'Bob', avatar_url: null },
      safeguarding: null,
    },
    cursor: null,
    has_more: false,
  },
};

type SafeguardingFixture = Record<string, unknown> | null;

const vettingRequiredMeta: SafeguardingFixture = {
  restricted: true,
  code: 'VETTING_REQUIRED',
  required_vetting_types: ['dbs_enhanced'],
  required_vetting_labels: ['Enhanced DBS'],
};

/**
 * Total mock for every GET the page makes, driven by ONE source of truth.
 *
 * MessagesController::show() calls getConversation() once and returns it as
 * meta.conversation on EVERY response — the initial load, the 5s
 * `direction=newer&cursor=…` poll and the `per_page=1` policy recheck all carry the
 * same safeguarding meta. A per-URL mock that lets them disagree is not merely
 * untidy, it is contract-impossible, and it made these tests wall-clock-dependent:
 * the composer gate is re-derived from whichever request answered last, so once a
 * render under CI load crossed the 5s poll interval the poll's stale answer
 * overwrote the state under test and the 1000ms waitFor could not recover. Two 5s
 * intervals are live here (message polling and the safeguarding recheck), so it
 * oscillated rather than failed once — which is why --retry=1 never rescued it.
 *
 * `afterRecheck` is applied when, and only when, the recheck endpoint is hit, so
 * each test still proves that Check again / focus / visibilitychange is what moved
 * the policy. The poll may then fire at any moment and only ever confirms it.
 */
function mockConversationApi(options: {
  initial: SafeguardingFixture;
  afterRecheck?: SafeguardingFixture;
}) {
  let safeguarding = options.initial;
  const flipsOnRecheck = 'afterRecheck' in options;

  const payload = () => ({
    ...mockConversationResponse,
    meta: {
      ...mockConversationResponse.meta,
      conversation: { ...mockConversationResponse.meta.conversation, safeguarding },
    },
  });

  mockApi.get.mockImplementation((url: string) => {
    if (url === '/v2/messages/restriction-status') {
      return Promise.resolve({
        success: true,
        data: { messaging_disabled: false, under_monitoring: false, restriction_reason: null },
      });
    }
    // refreshSafeguardingPolicy is the only caller that adds per_page=1.
    if (url.includes('per_page=1')) {
      if (flipsOnRecheck) safeguarding = options.afterRecheck!;
      return Promise.resolve(payload());
    }
    // Initial load AND the `direction=newer&cursor=MQ==` poll. Same endpoint,
    // same conversation meta — that is the whole point.
    return Promise.resolve(payload());
  });
  mockApi.put.mockResolvedValue({ success: true });
}

describe('ConversationPage — switching auto-translate off stops the running batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.scrollTo = vi.fn();
  });
  afterEach(() => {
    localStorage.removeItem('nexus_auto_translate_test');
  });
  it('does not restore translated content when an in-flight request finishes after switch-off', async () => {
    localStorage.setItem('nexus_auto_translate_test', JSON.stringify({ '20': 'en' }));
    mockApi.get.mockResolvedValue(mockConversationResponse);
    mockApi.put.mockResolvedValue({ success: true });
    let resolve!: (value: unknown) => void;
    mockApi.post.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    render(<ConversationPage />);
    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/v2/messages/2/translate', { target_language: 'en' }, expect.anything()));
    fireEvent.click(screen.getByLabelText('aria_more_options'));
    await waitFor(() => expect(screen.getByText('auto_translate.menu_disable')).toBeDefined());
    fireEvent.click(screen.getByText('auto_translate.menu_disable'));
    await act(async () => { resolve({ success: true, data: { translated_text: 'Old automatic translation' } }); });
    expect(screen.queryByText('Old automatic translation')).toBeNull();
    expect(screen.getByText('Hi Alice!')).toBeDefined();
  });
});
