// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AiChatPage — past conversations (list, reopen and continue, delete).
 * Mirrors web-uk's /ai/conversations journey against the Laravel
 * AiChatController list/get/delete endpoints.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  default: mockApi,
  api: mockApi,
  API_BASE: 'http://localhost:8090/api',
  tokenManager: {
    getAccessToken: vi.fn(() => 'test-token'),
    getTenantId: vi.fn(() => '2'),
    getCsrfToken: vi.fn(() => 'csrf-token'),
  },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test', last_name: 'User', avatar_url: null, avatar: null },
    isAuthenticated: true,
  })),
  useTenant: vi.fn(() => ({
    hasFeature: vi.fn(() => true),
    tenantPath: (p: string) => `/test${p}`,
  })),
  useToast: vi.fn(() => ({
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  })),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) => {
      const motionKeys = new Set(['variants', 'initial', 'animate', 'transition', 'exit', 'whileHover', 'whileTap', 'whileInView', 'viewport', 'layout']);
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) { if (!motionKeys.has(k)) rest[k] = v; }
      return <div {...rest}>{children}</div>;
    },
    span: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) => {
      const motionKeys = new Set(['variants', 'initial', 'animate', 'transition', 'exit']);
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) { if (!motionKeys.has(k)) rest[k] = v; }
      return <span {...rest}>{children}</span>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import AiChatPage from './AiChatPage';

Element.prototype.scrollIntoView = vi.fn();

const CONVERSATIONS = [
  { id: 7, title: 'Find a gardener', first_message: 'Find a gardener', message_count: 2, created_at: '2026-10-20 09:00:00', updated_at: '2026-10-20 09:05:00' },
  { id: 8, title: null, first_message: 'What events are on?', message_count: 4, created_at: '2026-10-21 10:00:00', updated_at: '2026-10-21 10:02:00' },
];

const CONVERSATION_7 = {
  id: 7,
  title: 'Find a gardener',
  messages: [
    { id: 70, conversation_id: 7, role: 'user', content: 'Find a gardener', created_at: '2026-10-20 09:00:00' },
    { id: 71, conversation_id: 7, role: 'assistant', content: 'Here are two gardeners near you.', created_at: '2026-10-20 09:00:05' },
    { id: 72, conversation_id: 7, role: 'system', content: 'internal prompt', created_at: '2026-10-20 09:00:06' },
  ],
};

function routeGets(overrides: Record<string, unknown> = {}) {
  mockApi.get.mockImplementation((url: string) => {
    if (url in overrides) return Promise.resolve(overrides[url]);
    if (url === '/ai/chat/starters') return Promise.resolve({ success: true, data: { starters: [] } });
    if (url === '/ai/conversations') return Promise.resolve({ success: true, data: CONVERSATIONS });
    if (url === '/ai/conversations/7') return Promise.resolve({ success: true, data: CONVERSATION_7 });
    return Promise.resolve({ success: false });
  });
}

async function openHistory() {
  fireEvent.click(screen.getByRole('button', { name: 'Past conversations' }));
  return screen.findByRole('dialog');
}

describe('AiChatPage — past conversations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeGets();
  });

  it('lists past conversations, falling back to the first message for an untitled one', async () => {
    render(<AiChatPage />);
    const dialog = await openHistory();

    expect(await within(dialog).findByText('Find a gardener')).toBeInTheDocument();
    expect(within(dialog).getByText('What events are on?')).toBeInTheDocument();
    expect(within(dialog).getByText(/Messages: 4/)).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith('/ai/conversations');
  });

  it('says so when there are no past conversations', async () => {
    routeGets({ '/ai/conversations': { success: true, data: [] } });
    render(<AiChatPage />);
    const dialog = await openHistory();

    expect(await within(dialog).findByText('You have no past conversations yet.')).toBeInTheDocument();
  });

  it('shows an error when the list cannot be loaded', async () => {
    routeGets({ '/ai/conversations': { success: false, error: 'boom' } });
    render(<AiChatPage />);
    const dialog = await openHistory();

    expect(await within(dialog).findByText('Could not load your past conversations. Please try again.')).toBeInTheDocument();
  });

  it('reopens a conversation, shows its messages, and continues it on the next send', async () => {
    mockApi.post.mockResolvedValue({
      success: true,
      data: { conversation_id: 7, message: { id: 73, role: 'assistant', content: 'Sure, here is another.' } },
    });
    const user = userEvent.setup();
    render(<AiChatPage />);
    const dialog = await openHistory();

    await user.click(await within(dialog).findByRole('button', { name: 'Open conversation "Find a gardener"' }));

    expect(await screen.findByText('Here are two gardeners near you.')).toBeInTheDocument();
    expect(screen.queryByText('internal prompt')).not.toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith('/ai/conversations/7');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const textarea = document.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'One more please' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/ai/chat', { message: 'One more please', conversation_id: 7 });
    });
  });

  it('shows an error and keeps the current chat when a conversation cannot be opened', async () => {
    routeGets({ '/ai/conversations/7': { success: false } });
    const user = userEvent.setup();
    render(<AiChatPage />);
    const dialog = await openHistory();

    await user.click(await within(dialog).findByRole('button', { name: 'Open conversation "Find a gardener"' }));

    expect(await within(dialog).findByText('Could not open the conversation. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText('Here are two gardeners near you.')).not.toBeInTheDocument();
  });

  it('deletes a conversation only after confirmation', async () => {
    mockApi.delete.mockResolvedValue({ success: true, data: { success: true } });
    const user = userEvent.setup();
    render(<AiChatPage />);
    const dialog = await openHistory();

    await user.click(await within(dialog).findByRole('button', { name: 'Delete conversation "Find a gardener"' }));
    expect(mockApi.delete).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Delete this conversation? This cannot be undone.')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Yes, delete it' }));

    await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('/ai/conversations/7'));
    await waitFor(() => expect(within(dialog).queryByText('Find a gardener')).not.toBeInTheDocument());
    expect(within(dialog).getByText('What events are on?')).toBeInTheDocument();
  });

  it('cancelling the confirmation keeps the conversation', async () => {
    const user = userEvent.setup();
    render(<AiChatPage />);
    const dialog = await openHistory();

    await user.click(await within(dialog).findByRole('button', { name: 'Delete conversation "Find a gardener"' }));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(mockApi.delete).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Find a gardener')).toBeInTheDocument();
  });

  it('starts a fresh chat when the open conversation is deleted', async () => {
    mockApi.delete.mockResolvedValue({ success: true, data: { success: true } });
    const user = userEvent.setup();
    render(<AiChatPage />);
    let dialog = await openHistory();
    await user.click(await within(dialog).findByRole('button', { name: 'Open conversation "Find a gardener"' }));
    expect(await screen.findByText('Here are two gardeners near you.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    dialog = await openHistory();
    await user.click(await within(dialog).findByRole('button', { name: 'Delete conversation "Find a gardener"' }));
    await user.click(within(dialog).getByRole('button', { name: 'Yes, delete it' }));

    await waitFor(() => expect(screen.queryByText('Here are two gardeners near you.')).not.toBeInTheDocument());
  });
});
