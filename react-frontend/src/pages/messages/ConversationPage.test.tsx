// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

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
  MessageBubble: ({ message }: { message: { content: string } }) => (
    <div data-testid="message-bubble">{message.content}</div>
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

describe('ConversationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom doesn't provide scrollIntoView/scrollTo — stub them so the component doesn't crash
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows loading screen while fetching', () => {
    mockApi.get.mockReturnValue(new Promise(() => {}));
    mockApi.put.mockResolvedValue({ success: true });
    render(<ConversationPage />);
    expect(screen.getByTestId('loading-screen')).toBeDefined();
  });

  it('renders conversation after loading', async () => {
    mockApi.get.mockResolvedValue(mockConversationResponse);
    mockApi.put.mockResolvedValue({ success: true });

    render(<ConversationPage />);

    await waitFor(() => {
      expect(screen.getByText('Hello Bob!')).toBeDefined();
      expect(screen.getByText('Hi Alice!')).toBeDefined();
    });
  });

  it('hides the generic review notice only when broker visibility is explicitly disabled', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/v2/messages/restriction-status') {
        return Promise.resolve({
          success: true,
          data: {
            messaging_disabled: false,
            under_monitoring: false,
            restriction_reason: null,
            review_notice_required: false,
          },
        });
      }
      return Promise.resolve(mockConversationResponse);
    });
    mockApi.put.mockResolvedValue({ success: true });

    render(<ConversationPage />);

    await waitFor(() => expect(screen.getByText('Hello Bob!')).toBeDefined());
    await waitFor(() => expect(screen.queryByText('safeguarding_notice')).toBeNull());
  });

  it('keeps the generic review notice when policy status cannot be loaded', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/v2/messages/restriction-status') {
        return Promise.reject(new Error('policy status unavailable'));
      }
      return Promise.resolve(mockConversationResponse);
    });
    mockApi.put.mockResolvedValue({ success: true });

    render(<ConversationPage />);

    // Exactly one full notice is mounted: the sm:+ banner. The phone pill carries
    // the same body inside a Popover, and the real HeroUI Popover only mounts its
    // content once opened — so the pill contributes the compact label below, not a
    // second full notice.
    await waitFor(() => expect(screen.getAllByText('safeguarding_notice')).toHaveLength(1));
    expect(screen.getByText('safeguarding_notice_compact')).toBeDefined();
  });

  it('marks the thread immersive and folds header actions into the overflow menu on phones', async () => {
    mockApi.get.mockResolvedValue(mockConversationResponse);
    mockApi.put.mockResolvedValue({ success: true });

    render(<ConversationPage />);

    await waitFor(() => expect(screen.getByText('Bob')).toBeDefined());

    // Marker drives the body:has() CSS that hides the site header <768px.
    // Exactly one — a duplicate marker would mean the thread root rendered twice.
    expect(document.querySelectorAll('[data-immersive-thread]')).toHaveLength(1);

    // Phone-only overflow rows (visibility is CSS-gated via sm:hidden) —
    // the real dropdown only mounts its items once opened
    fireEvent.click(screen.getByLabelText('aria_more_options'));
    await waitFor(() => expect(screen.getByText('aria_search_messages')).toBeDefined());
    expect(screen.getByText('auto_translate.menu_enable')).toBeDefined();
    expect(screen.getByText('aria_view_profile')).toBeDefined();

    // Compact verified treatment: icon beside the name plus a labeled status line
    expect(screen.getByLabelText('common:verification.badge.id_verified')).toBeDefined();
    expect(screen.getByText(/common:verification\.badge\.id_verified/)).toBeDefined();
  });

  it('dismisses both safeguarding notices from the phone pill X', async () => {
    mockApi.get.mockResolvedValue(mockConversationResponse);
    mockApi.put.mockResolvedValue({ success: true });

    render(<ConversationPage />);

    await waitFor(() => expect(screen.getByText('safeguarding_notice_compact')).toBeDefined());

    // Pin how many dismiss controls are actually mounted, so this can't silently
    // start clicking a different X than the test name claims.
    const dismissControls = screen.getAllByLabelText('aria_dismiss_safeguarding');
    expect(dismissControls).toHaveLength(2);
    // Either control clears the shared state that gates both notices.
    fireEvent.click(dismissControls[0]!);

    await waitFor(() => expect(screen.queryByText('safeguarding_notice_compact')).toBeNull());
    expect(screen.queryByText('safeguarding_notice')).toBeNull();
  });

  it('renders message input area', async () => {
    mockApi.get.mockResolvedValue(mockConversationResponse);
    mockApi.put.mockResolvedValue({ success: true });

    render(<ConversationPage />);

    await waitFor(() => expect(screen.getByTestId('message-input-area')).toBeDefined());
  });

  it('shows other user name in header', async () => {
    mockApi.get.mockResolvedValue(mockConversationResponse);
    mockApi.put.mockResolvedValue({ success: true });

    render(<ConversationPage />);

    await waitFor(() => expect(screen.getByText('Bob')).toBeDefined());
  });

  it('renders back navigation button', async () => {
    mockApi.get.mockResolvedValue(mockConversationResponse);
    mockApi.put.mockResolvedValue({ success: true });

    render(<ConversationPage />);

    // Wait for conversation to fully render, then check back button
    await waitFor(() => {
      expect(screen.getByTestId('message-input-area')).toBeDefined();
      // Back button should be present with aria-label (t('aria_back') returns the key)
      expect(screen.getByLabelText(/back/i)).toBeDefined();
    });
  });

  it('shows an in-page safeguarding panel when vetting is required to message', async () => {
    mockApi.get.mockResolvedValue(mockConversationResponse);
    mockApi.put.mockResolvedValue({ success: true });
    mockApi.post.mockResolvedValue({
      success: false,
      code: 'VETTING_REQUIRED',
      error: 'This conversation is paused by a community safeguarding rule.',
      errors: [{
        code: 'VETTING_REQUIRED',
        message: 'This conversation is paused by a community safeguarding rule.',
        required_vetting_types: ['dbs_enhanced'],
        required_vetting_labels: ['DBS Enhanced'],
      }],
    });

    render(<ConversationPage />);

    await waitFor(() => expect(screen.getByLabelText('mock-message-input')).toBeDefined());

    fireEvent.change(screen.getByLabelText('mock-message-input'), {
      target: { value: 'Hello Sarah' },
    });
    fireEvent.submit(screen.getByTestId('message-input-area'));

    await waitFor(() => {
      expect(screen.getByText('safeguarding_vetting_required.title')).toBeDefined();
      expect(screen.getByText('DBS Enhanced')).toBeDefined();
    });
    expect(stableMocks.toastError).not.toHaveBeenCalledWith('error_title', expect.any(String));
  });

  it('shows an in-page safeguarding panel when coordinator-mediated contact is required', async () => {
    mockApi.get.mockResolvedValue(mockConversationResponse);
    mockApi.put.mockResolvedValue({ success: true });
    mockApi.post.mockResolvedValue({
      success: false,
      code: 'SAFEGUARDING_CONTACT_RESTRICTED',
      error: 'This member has asked for a coordinator to arrange contact on their behalf.',
      errors: [{
        code: 'SAFEGUARDING_CONTACT_RESTRICTED',
        message: 'This member has asked for a coordinator to arrange contact on their behalf.',
        detail: 'This member is not available for direct messages because their safeguarding preferences require coordinator-mediated contact.',
      }],
    });

    render(<ConversationPage />);

    await waitFor(() => expect(screen.getByLabelText('mock-message-input')).toBeDefined());

    fireEvent.change(screen.getByLabelText('mock-message-input'), {
      target: { value: 'Hello Sarah' },
    });
    fireEvent.submit(screen.getByTestId('message-input-area'));

    await waitFor(() => {
      expect(screen.getByText('safeguarding_contact_restricted.title')).toBeDefined();
      expect(screen.getByText(/coordinator-mediated contact/i)).toBeDefined();
    });
    // Safeguarding decisions remain fail-closed and cannot be dismissed locally.
    expect(screen.queryByLabelText('safeguarding_contact_restricted.dismiss')).toBeNull();
    expect(stableMocks.toastError).not.toHaveBeenCalledWith('error_title', expect.any(String));
  });

  it('shows the safeguarding panel immediately on load (before typing) and disables the composer', async () => {
    mockApi.get.mockResolvedValue({
      ...mockConversationResponse,
      meta: {
        ...mockConversationResponse.meta,
        conversation: {
          ...mockConversationResponse.meta.conversation,
          safeguarding: {
            restricted: true,
            code: 'SAFEGUARDING_CONTACT_RESTRICTED',
            message: 'Coordinator arrangement needed',
            detail: 'This member is not available for direct messages because their safeguarding preferences require coordinator-mediated contact.',
            action_label: null,
            required_vetting_types: [],
            required_vetting_labels: [],
            can_request_coordinator: true,
          },
        },
      },
    });
    mockApi.put.mockResolvedValue({ success: true });

    render(<ConversationPage />);

    // Panel appears purely from the load payload — no typing, no submit.
    await waitFor(() => {
      expect(screen.getByText('safeguarding_contact_restricted.title')).toBeDefined();
      expect(screen.getByText(/coordinator-mediated contact/i)).toBeDefined();
    });

    // Composer is replaced before the member can type.
    expect(screen.queryByTestId('message-input-area')).toBeNull();
    expect(screen.getByTestId('composer-blocked')).toBeDefined();

    // The load-time (preflight) panel must NOT be dismissable — dismissing would
    // re-enable the composer and let a blocked send alert staff, bypassing the
    // explicit "Request coordinator help" affordance.
    expect(screen.queryByLabelText('safeguarding_contact_restricted.dismiss')).toBeNull();

    // Opening the conversation must not fire any coordinator/alert request.
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('fires a coordinator help request when the panel button is clicked and confirms success', async () => {
    mockApi.get.mockResolvedValue({
      ...mockConversationResponse,
      meta: {
        ...mockConversationResponse.meta,
        conversation: {
          ...mockConversationResponse.meta.conversation,
          safeguarding: {
            restricted: true,
            code: 'SAFEGUARDING_CONTACT_RESTRICTED',
            detail: 'This member is not available for direct messages because their safeguarding preferences require coordinator-mediated contact.',
            required_vetting_types: [],
            required_vetting_labels: [],
            can_request_coordinator: true,
          },
        },
      },
    });
    mockApi.put.mockResolvedValue({ success: true });
    mockApi.post.mockResolvedValue({ success: true, data: { success: true, code: 'SAFEGUARDING_CONTACT_RESTRICTED' } });

    render(<ConversationPage />);

    await waitFor(() => expect(screen.getByText('coordinator_request.button')).toBeDefined());

    fireEvent.click(screen.getByText('coordinator_request.button'));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/messages/42/request-coordinator', {});
    });

    // Sender gets clear in-panel confirmation.
    await waitFor(() => expect(screen.getByText('coordinator_request.sent')).toBeDefined());
  });

  it('requests a vetting review with an empty request body', async () => {
    mockApi.get.mockResolvedValue({
      ...mockConversationResponse,
      meta: {
        ...mockConversationResponse.meta,
        conversation: {
          ...mockConversationResponse.meta.conversation,
          safeguarding: {
            restricted: true,
            code: 'VETTING_REQUIRED',
            detail: 'Community confirmation is needed.',
            required_vetting_types: ['dbs_enhanced'],
            required_vetting_labels: ['Enhanced DBS'],
            can_request_coordinator: true,
          },
        },
      },
    });
    mockApi.put.mockResolvedValue({ success: true });
    mockApi.post.mockResolvedValue({ success: true, data: { status: 'pending' } });

    render(<ConversationPage />);
    await waitFor(() => expect(screen.getByText('vetting_review_request.button')).toBeDefined());
    fireEvent.click(screen.getByText('vetting_review_request.button'));

    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/v2/safeguarding/vetting-review-request'));
    expect(screen.getByText('vetting_review_request.sent')).toBeDefined();
  });

  it('fails closed when the safeguarding policy is unavailable', async () => {
    mockApi.get.mockResolvedValue({
      ...mockConversationResponse,
      meta: {
        ...mockConversationResponse.meta,
        conversation: {
          ...mockConversationResponse.meta.conversation,
          safeguarding: {
            restricted: true,
            code: 'SAFEGUARDING_POLICY_UNAVAILABLE',
            detail: 'The policy could not be evaluated safely.',
            required_vetting_types: [],
            required_vetting_labels: [],
            can_request_coordinator: true,
          },
        },
      },
    });
    mockApi.put.mockResolvedValue({ success: true });

    render(<ConversationPage />);

    await waitFor(() => expect(screen.getByText('safeguarding_policy_unavailable.title')).toBeDefined());
    expect(screen.getByTestId('composer-blocked')).toBeDefined();
    expect(screen.queryByTestId('message-input-area')).toBeNull();
  });

  it('unlocks an open conversation when Check again returns allow', async () => {
    const blocked = {
      ...mockConversationResponse,
      meta: {
        ...mockConversationResponse.meta,
        conversation: {
          ...mockConversationResponse.meta.conversation,
          safeguarding: {
            restricted: true,
            code: 'VETTING_REQUIRED',
            required_vetting_types: ['dbs_enhanced'],
            required_vetting_labels: ['Enhanced DBS'],
          },
        },
      },
    };
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/v2/messages/restriction-status') {
        return Promise.resolve({ success: true, data: { messaging_disabled: false, under_monitoring: false, restriction_reason: null } });
      }
      if (url.includes('per_page=1')) {
        return Promise.resolve(mockConversationResponse);
      }
      return Promise.resolve(blocked);
    });
    mockApi.put.mockResolvedValue({ success: true });

    render(<ConversationPage />);
    await waitFor(() => expect(screen.getByText('safeguarding_check_again')).toBeDefined());
    fireEvent.click(screen.getByText('safeguarding_check_again'));

    await waitFor(() => expect(screen.getByTestId('message-input-area')).toBeDefined());
    expect(screen.queryByText('safeguarding_vetting_required.title')).toBeNull();
  });

  it('automatically unlocks a blocked empty conversation after the recipient clears their preference', async () => {
    vi.useFakeTimers();

    const blockedEmptyConversation = {
      ...mockConversationResponse,
      data: [],
      meta: {
        ...mockConversationResponse.meta,
        conversation: {
          ...mockConversationResponse.meta.conversation,
          safeguarding: {
            restricted: true,
            code: 'VETTING_REQUIRED',
            required_vetting_types: ['dbs_enhanced'],
            required_vetting_labels: ['Enhanced DBS'],
          },
        },
      },
    };
    const allowedEmptyConversation = {
      ...mockConversationResponse,
      data: [],
      meta: {
        ...mockConversationResponse.meta,
        conversation: {
          ...mockConversationResponse.meta.conversation,
          safeguarding: null,
        },
      },
    };

    mockApi.get.mockImplementation((url: string) => {
      if (url === '/v2/messages/restriction-status') {
        return Promise.resolve({ success: true, data: { messaging_disabled: false, under_monitoring: false, restriction_reason: null } });
      }
      if (url.includes('per_page=1')) return Promise.resolve(allowedEmptyConversation);
      return Promise.resolve(blockedEmptyConversation);
    });
    mockApi.put.mockResolvedValue({ success: true });

    render(<ConversationPage />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('composer-blocked')).toBeDefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(mockApi.get).toHaveBeenCalledWith('/v2/messages/42?per_page=1');
    expect(screen.getByTestId('message-input-area')).toBeDefined();
    expect(screen.queryByText('safeguarding_vetting_required.title')).toBeNull();
  });

  it('rechecks on window focus and re-locks after revocation', async () => {
    const revoked = {
      ...mockConversationResponse,
      meta: {
        ...mockConversationResponse.meta,
        conversation: {
          ...mockConversationResponse.meta.conversation,
          safeguarding: {
            restricted: true,
            code: 'VETTING_REQUIRED',
            required_vetting_types: ['dbs_enhanced'],
            required_vetting_labels: ['Enhanced DBS'],
          },
        },
      },
    };
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/v2/messages/restriction-status') {
        return Promise.resolve({ success: true, data: { messaging_disabled: false, under_monitoring: false, restriction_reason: null } });
      }
      if (url.includes('per_page=1')) return Promise.resolve(revoked);
      return Promise.resolve(mockConversationResponse);
    });
    mockApi.put.mockResolvedValue({ success: true });

    render(<ConversationPage />);
    await waitFor(() => expect(screen.getByTestId('message-input-area')).toBeDefined());
    window.dispatchEvent(new Event('focus'));

    await waitFor(() => expect(screen.getByTestId('composer-blocked')).toBeDefined());
  });

  it('rechecks when the document becomes visible', async () => {
    const blocked = {
      ...mockConversationResponse,
      meta: {
        ...mockConversationResponse.meta,
        conversation: {
          ...mockConversationResponse.meta.conversation,
          safeguarding: {
            restricted: true,
            code: 'VETTING_REQUIRED',
            required_vetting_types: ['dbs_enhanced'],
            required_vetting_labels: ['Enhanced DBS'],
          },
        },
      },
    };
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/v2/messages/restriction-status') {
        return Promise.resolve({ success: true, data: { messaging_disabled: false, under_monitoring: false, restriction_reason: null } });
      }
      if (url.includes('per_page=1')) return Promise.resolve(mockConversationResponse);
      return Promise.resolve(blocked);
    });
    mockApi.put.mockResolvedValue({ success: true });

    render(<ConversationPage />);
    await waitFor(() => expect(screen.getByTestId('composer-blocked')).toBeDefined());
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(screen.getByTestId('message-input-area')).toBeDefined());
  });
});
