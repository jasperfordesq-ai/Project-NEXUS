// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...actual,
    resolveAvatarUrl: (url: string | null) => url ?? '',
    formatRelativeTime: () => '2 min ago',
  };
});

// ─── Toast / Auth / Tenant ───────────────────────────────────────────────────
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
};

const mockConfirm = vi.fn();

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Test User', role: 'member' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useToast: () => mockToast,
    usePusherOptional: () => null,
  })
);

// TeamChatrooms imports usePusherOptional from '@/contexts/PusherContext' directly, so the
// override in the '@/contexts' barrel above is dead — vitest resolves mocks per specifier.
// Without this the real PusherContext loads, along with its own direct AuthContext import.
vi.mock('@/contexts/PusherContext', () => ({
  usePusherOptional: () => null,
  usePusher: () => ({ channel: null, isConnected: false }),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/components/ui/ConfirmDialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/ConfirmDialog')>();
  return { ...actual, useConfirm: () => mockConfirm };
});

// Stub feedback
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title }: { title: string }) => (
    <div data-testid="empty-state">{title}</div>
  ),
}));

// scrollIntoView is not implemented in jsdom
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeChatroom = (overrides = {}) => ({
  id: 10,
  group_id: 5,
  name: 'general',
  description: null,
  category: null,
  is_default: true,
  is_private: false,
  messages_count: 3,
  created_at: '2025-01-01T10:00:00Z',
  ...overrides,
});

const makeMessage = (overrides = {}) => ({
  id: 100,
  chatroom_id: 10,
  user_id: 2,
  body: 'Hello world',
  created_at: '2025-01-01T10:05:00Z',
  author: { id: 2, name: 'Alice', avatar_url: null },
  ...overrides,
});

const okChatrooms = { success: true, data: [makeChatroom()] };
const emptyMessages = { success: true, data: [] };
const emptyPinned = { success: true, data: [] };

/** Helper to wait for chatroom sidebar to be ready */
const waitForChatroom = async (name = 'general') => {
  await waitFor(() => {
    const matches = screen.getAllByText(name);
    expect(matches.length).toBeGreaterThan(0);
  });
};

// ─────────────────────────────────────────────────────────────────────────────
describe('TeamChatrooms', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // default: one chatroom, no messages, no pins
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/messages')) return Promise.resolve(emptyMessages);
      if (url.includes('/pinned')) return Promise.resolve(emptyPinned);
      // chatroom list
      return Promise.resolve(okChatrooms);
    });
    mockConfirm.mockResolvedValue(true);
    // scrollIntoView polyfill per-test
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('shows loading spinner initially', async () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));
    const { TeamChatrooms } = await import('./TeamChatrooms');
    render(<TeamChatrooms groupId={5} isGroupAdmin={false} />);

    const statusEls = screen.getAllByRole('status');
    const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders channel name in sidebar after load', async () => {
    const { TeamChatrooms } = await import('./TeamChatrooms');
    render(<TeamChatrooms groupId={5} isGroupAdmin={false} />);

    await waitFor(() => {
      // 'general' appears in sidebar AND in header — use getAllByText
      const matches = screen.getAllByText('general');
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('renders the Channels heading', async () => {
    const { TeamChatrooms } = await import('./TeamChatrooms');
    render(<TeamChatrooms groupId={5} isGroupAdmin={false} />);

    expect(await screen.findByRole('heading', { name: 'Channels' })).toBeInTheDocument();
  });

  it('uses a mobile channel navigator without forcing the desktop sidebar width', async () => {
    const { TeamChatrooms } = await import('./TeamChatrooms');
    render(<TeamChatrooms groupId={5} isGroupAdmin={false} />);

    const navigator = await screen.findByRole('navigation', { name: 'Channels' });
    expect(navigator).toHaveClass('w-full', 'md:w-48');
    expect(navigator.parentElement).toHaveClass('flex-col', 'md:flex-row', 'min-w-0');

    const activeChannel = screen.getByRole('button', { name: 'general' });
    expect(activeChannel).toHaveAttribute('aria-current', 'page');
    expect(activeChannel).toHaveClass('min-h-11', 'min-w-[9rem]', 'md:w-full');
    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('button', { name: 'Send' })).toHaveClass('h-11', 'w-11');
  });

  it('announces pinned-message expansion and controls the pinned region', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/messages')) return Promise.resolve(emptyMessages);
      if (url.includes('/pinned')) {
        return Promise.resolve({
          success: true,
          data: [{ ...makeMessage(), pinned_by: 1, pinned_at: '2025-01-01T10:06:00Z' }],
        });
      }
      return Promise.resolve(okChatrooms);
    });

    const { TeamChatrooms } = await import('./TeamChatrooms');
    render(<TeamChatrooms groupId={5} isGroupAdmin={false} />);

    const toggle = await screen.findByRole('button', { name: 'Show pinned messages' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'group-chatroom-pinned-messages');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('group-chatroom-pinned-messages')).toBeInTheDocument();
  });

  it('fetches the channel list and first channel messages', async () => {
    const { TeamChatrooms } = await import('./TeamChatrooms');
    render(<TeamChatrooms groupId={5} isGroupAdmin={false} />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/groups/5/chatrooms');
      expect(mockApi.get).toHaveBeenCalledWith('/v2/group-chatrooms/10/messages');
    });
  });

  it('shows the authenticated message composer', async () => {
    const { TeamChatrooms } = await import('./TeamChatrooms');
    render(<TeamChatrooms groupId={5} isGroupAdmin={false} />);

    expect(await screen.findByRole('textbox', { name: 'Type a message...' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('shows the delete-channel action to group admins', async () => {
    const { TeamChatrooms } = await import('./TeamChatrooms');
    render(<TeamChatrooms groupId={5} isGroupAdmin={true} />);

    expect(await screen.findByRole('button', { name: 'Delete Channel' })).toBeInTheDocument();
  });

  it('shows empty-state when no chatrooms and no active chatroom', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: [] });
    const { TeamChatrooms } = await import('./TeamChatrooms');
    render(<TeamChatrooms groupId={5} isGroupAdmin={false} />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('shows + create channel button for admin', async () => {
    const { TeamChatrooms } = await import('./TeamChatrooms');
    render(<TeamChatrooms groupId={5} isGroupAdmin={true} />);

    await waitForChatroom();

    await waitFor(() => {
      const btn = screen.getAllByRole('button').find(
        (b) =>
          b.getAttribute('aria-label')?.toLowerCase().includes('creat') ||
          b.getAttribute('aria-label')?.toLowerCase().includes('chatrooms.create')
      );
      expect(btn).toBeDefined();
    });
  });

  it('does not show + create channel button for non-admin', async () => {
    const { TeamChatrooms } = await import('./TeamChatrooms');
    render(<TeamChatrooms groupId={5} isGroupAdmin={false} />);

    await waitForChatroom();

    const createBtn = screen.queryAllByRole('button').find(
      (b) =>
        b.getAttribute('aria-label')?.includes('chatrooms.create') ||
        (b.getAttribute('aria-label')?.toLowerCase().includes('creat') &&
         b.getAttribute('aria-label')?.toLowerCase().includes('channel'))
    );
    expect(createBtn).toBeUndefined();
  });

  it('renders messages in the chat area', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/messages')) return Promise.resolve({ success: true, data: [makeMessage()] });
      if (url.includes('/pinned')) return Promise.resolve(emptyPinned);
      return Promise.resolve(okChatrooms);
    });

    const { TeamChatrooms } = await import('./TeamChatrooms');
    render(<TeamChatrooms groupId={5} isGroupAdmin={false} />);

    await waitFor(() => {
      expect(screen.getByText('Hello world')).toBeInTheDocument();
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
  });

  it('sends a message via POST when user submits', async () => {
    mockApi.post.mockResolvedValue({ success: true });

    const { TeamChatrooms } = await import('./TeamChatrooms');
    render(<TeamChatrooms groupId={5} isGroupAdmin={false} />);

    await waitForChatroom();

    // Find message input — it has placeholder from t('chatrooms.message_placeholder')
    const inputs = screen.getAllByRole('textbox');
    const msgInput = inputs.find(
      (i) =>
        i.getAttribute('aria-label')?.toLowerCase().includes('message') ||
        i.getAttribute('placeholder')?.toLowerCase().includes('message') ||
        i.getAttribute('aria-label')?.includes('chatrooms.message_placeholder')
    );
    expect(msgInput).toBeDefined();
    fireEvent.change(msgInput!, { target: { value: 'Hi there' } });

    // Find send button
    const sendBtn = screen.getAllByRole('button').find(
      (b) =>
        b.getAttribute('aria-label')?.toLowerCase().includes('send') ||
        b.getAttribute('aria-label')?.includes('chatrooms.send')
    );
    expect(sendBtn).toBeDefined();
    fireEvent.click(sendBtn!);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        '/v2/group-chatrooms/10/messages',
        expect.objectContaining({ body: 'Hi there' }),
      );
    });
  });

  it('calls DELETE and removes message when user is message owner', async () => {
    // User id=1 is the auth user; make message owned by user id=1
    mockApi.delete.mockResolvedValue({ success: true });
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/messages')) {
        return Promise.resolve({ success: true, data: [makeMessage({ user_id: 1 })] });
      }
      if (url.includes('/pinned')) return Promise.resolve(emptyPinned);
      return Promise.resolve(okChatrooms);
    });

    const { TeamChatrooms } = await import('./TeamChatrooms');
    render(<TeamChatrooms groupId={5} isGroupAdmin={false} />);

    await waitFor(() => screen.getByText('Hello world'));

    const deleteBtn = screen.getAllByRole('button').find(
      (b) =>
        b.getAttribute('aria-label')?.toLowerCase().includes('delete') ||
        b.getAttribute('aria-label')?.toLowerCase().includes('comments.delete')
    );
    expect(deleteBtn).toBeDefined();
    fireEvent.click(deleteBtn!);

    await waitFor(() => {
      expect(mockApi.delete).toHaveBeenCalledWith('/v2/group-chatroom-messages/100');
    });
  });

  it('calls pin endpoint when admin pins a message', async () => {
    mockApi.post.mockResolvedValue({ success: true });
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/messages')) return Promise.resolve({ success: true, data: [makeMessage()] });
      if (url.includes('/pinned')) return Promise.resolve(emptyPinned);
      return Promise.resolve(okChatrooms);
    });

    const { TeamChatrooms } = await import('./TeamChatrooms');
    render(<TeamChatrooms groupId={5} isGroupAdmin={true} />);

    await waitFor(() => screen.getByText('Hello world'));

    const pinBtn = screen.getAllByRole('button').find(
      (b) =>
        b.getAttribute('aria-label')?.toLowerCase().includes('pin') &&
        !b.getAttribute('aria-label')?.toLowerCase().includes('unpin')
    );
    expect(pinBtn).toBeDefined();
    fireEvent.click(pinBtn!);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        '/v2/groups/5/chatrooms/10/pin/100',
        {},
      );
    });
  });

  it('shows error toast when send fails', async () => {
    mockApi.post.mockRejectedValue(new Error('network'));

    const { TeamChatrooms } = await import('./TeamChatrooms');
    render(<TeamChatrooms groupId={5} isGroupAdmin={false} />);

    await waitForChatroom();

    const inputs = screen.getAllByRole('textbox');
    const msgInput = inputs.find(
      (i) =>
        i.getAttribute('aria-label')?.toLowerCase().includes('message') ||
        i.getAttribute('aria-label')?.includes('chatrooms.message_placeholder')
    );
    expect(msgInput).toBeDefined();
    fireEvent.change(msgInput!, { target: { value: 'test msg' } });

    const sendBtn = screen.getAllByRole('button').find(
      (b) =>
        b.getAttribute('aria-label')?.toLowerCase().includes('send') ||
        b.getAttribute('aria-label')?.includes('chatrooms.send')
    );
    expect(sendBtn).toBeDefined();
    fireEvent.click(sendBtn!);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows private channel name in sidebar', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/messages')) return Promise.resolve(emptyMessages);
      if (url.includes('/pinned')) return Promise.resolve(emptyPinned);
      return Promise.resolve({
        success: true,
        data: [makeChatroom({ is_private: true, name: 'secret-channel' })],
      });
    });

    const { TeamChatrooms } = await import('./TeamChatrooms');
    render(<TeamChatrooms groupId={5} isGroupAdmin={true} />);

    await waitFor(() => {
      const matches = screen.getAllByText('secret-channel');
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('opens create channel modal when + button clicked (admin)', async () => {
    const { TeamChatrooms } = await import('./TeamChatrooms');
    render(<TeamChatrooms groupId={5} isGroupAdmin={true} />);

    await waitForChatroom();

    const createBtn = screen.getAllByRole('button').find(
      (b) =>
        b.getAttribute('aria-label')?.toLowerCase().includes('creat') ||
        b.getAttribute('aria-label')?.includes('chatrooms.create')
    );
    expect(createBtn).toBeDefined();
    fireEvent.click(createBtn!);

    await waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).toBeTruthy();
    });
  });

  it('calls POST to create channel when form submitted', async () => {
    mockApi.post.mockResolvedValue({
      success: true,
      data: makeChatroom({ id: 20, name: 'new-channel' }),
    });

    const { TeamChatrooms } = await import('./TeamChatrooms');
    render(<TeamChatrooms groupId={5} isGroupAdmin={true} />);

    await waitForChatroom();

    fireEvent.click(screen.getByRole('button', { name: 'Create Channel' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: 'my-new-channel' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Channel' }));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        '/v2/groups/5/chatrooms',
        expect.objectContaining({ name: 'my-new-channel' }),
      );
    });
  });
});
