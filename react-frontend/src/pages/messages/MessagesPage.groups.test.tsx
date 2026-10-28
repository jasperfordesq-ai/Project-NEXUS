// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MessagesPage — group chats.
 *
 * 🔴 Regression: creating a group used to navigate to /messages/{groupId}.
 * That route is the ONE-TO-ONE thread whose id is the other member's user id,
 * so it opened a private chat with whichever member's id equalled the group's.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const mockNavigate = vi.hoisted(() => vi.fn());
const mockSearch = vi.hoisted(() => ({ value: '' }));

vi.mock('@/lib/api', () => ({ api: mockApi, tokenManager: { getTenantId: vi.fn() } }));
vi.mock('@/contexts', () => ({
  useAuth: () => ({ user: { id: 1, first_name: 'Test' }, isAuthenticated: true }),
  useTenant: () => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: () => true,
    hasModule: () => true,
  }),
  usePusherOptional: () => null,
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
}));
vi.mock('@/contexts/PusherContext', () => ({ usePusherOptional: () => null }));
vi.mock('@/contexts/PresenceContext', () => ({ usePresenceOptional: () => null }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams(mockSearch.value), vi.fn()] as const,
  };
});
// Stand-in for the create dialog: reports a created group with id 77.
vi.mock('./components/CreateGroupModal', () => ({
  CreateGroupModal: ({ isOpen, onCreated }: { isOpen: boolean; onCreated: (id: number) => void }) => (
    isOpen ? <button type="button" onClick={() => onCreated(77)}>stub-create-group</button> : null
  ),
}));

import { MessagesPage } from './MessagesPage';

const GROUPS = [
  {
    id: 77,
    is_group: true,
    group_name: 'Garden helpers',
    participant_count: 3,
    participants: [],
    unread_count: 2,
    last_message: { id: 5, body: 'See you Saturday', sender_id: 2, sender_name: 'Ben', created_at: '2026-10-27 10:00:00' },
  },
  { id: 78, is_group: true, group_name: null, participant_count: 4, participants: [], unread_count: 0 },
];

function routeGets(groups: unknown = { success: true, data: GROUPS }) {
  mockApi.get.mockImplementation((url: string) => {
    if (url === '/v2/conversations/groups') return Promise.resolve(groups);
    if (url === '/v2/messages/restriction-status') return Promise.resolve({ success: true, data: { messaging_disabled: false } });
    return Promise.resolve({ success: true, data: [] });
  });
}

describe('MessagesPage — group chats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.value = '';
    routeGets();
  });

  it('opens a newly created group in the group chat route, never the one-to-one route', async () => {
    render(<MessagesPage />);

    fireEvent.click(screen.getByRole('button', { name: 'New Group' }));
    fireEvent.click(await screen.findByRole('button', { name: 'stub-create-group' }));

    expect(mockNavigate).toHaveBeenCalledWith('/test/messages/group/77');
    expect(mockNavigate).not.toHaveBeenCalledWith('/test/messages/77');
  });

  it('lists the member\'s group chats on the Groups tab, each linking to its group chat', async () => {
    render(<MessagesPage />);

    fireEvent.click(screen.getByRole('tab', { name: /Groups/ }));

    const link = await screen.findByRole('link', { name: 'Open group chat Garden helpers' });
    expect(link).toHaveAttribute('href', '/test/messages/group/77');
    expect(screen.getByText('See you Saturday')).toBeInTheDocument();
    // An unnamed group still gets a usable label.
    expect(screen.getByRole('link', { name: 'Open group chat Group chat' })).toHaveAttribute('href', '/test/messages/group/78');
    expect(mockApi.get).toHaveBeenCalledWith('/v2/conversations/groups');
  });

  it('opens straight onto the Groups tab when asked to (back link from a group chat)', async () => {
    mockSearch.value = 'tab=groups';
    render(<MessagesPage />);

    expect(await screen.findByRole('link', { name: 'Open group chat Garden helpers' })).toBeInTheDocument();
  });

  it('says so when the member is in no group chats', async () => {
    routeGets({ success: true, data: [] });
    render(<MessagesPage />);
    fireEvent.click(screen.getByRole('tab', { name: /Groups/ }));

    expect(await screen.findByText('You are not in any group chats yet.')).toBeInTheDocument();
  });

  it('shows an error when the group chats cannot be loaded', async () => {
    routeGets({ success: false });
    render(<MessagesPage />);
    fireEvent.click(screen.getByRole('tab', { name: /Groups/ }));

    await waitFor(() => expect(screen.getByText('Could not load your group chats.')).toBeInTheDocument());
  });
});
