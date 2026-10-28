// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GroupConversationPage — React's group chat thread, against
 * GroupConversationController::messages / sendMessage and the shared
 * message reaction endpoints.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';

const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn(), put: vi.fn() }));
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() }));
const mockNavigate = vi.hoisted(() => vi.fn());
const mockFeatures = vi.hoisted(() => ({ direct_messaging: true }));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/contexts', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Ada Admin', first_name: 'Ada' }, isAuthenticated: true }),
  useToast: () => mockToast,
  useTenant: () => ({
    tenantPath: (p: string) => `/test${p}`,
    tenantSlug: 'test',
    hasFeature: (f: string) => (f === 'direct_messaging' ? mockFeatures.direct_messaging : false),
    hasModule: () => true,
  }),
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
}));
// MessageBubble reads the tenant context directly, not through the barrel.
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenantPath: (p: string) => `/test${p}`, hasFeature: () => false, hasModule: () => true }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useParams: () => ({ id: '42' }),
  useNavigate: () => mockNavigate,
}));
// The members dialog has its own tests; here only its wiring matters.
vi.mock('./components/GroupMembersModal', () => ({
  GroupMembersModal: ({ isOpen, onLeft }: { isOpen: boolean; onLeft?: () => void }) => (isOpen ? (
    <div role="dialog" aria-label="members-dialog">
      <button type="button" onClick={() => onLeft?.()}>stub-leave</button>
    </div>
  ) : null),
}));

import { GroupConversationPage } from './GroupConversationPage';

Element.prototype.scrollIntoView = vi.fn();

const CONVERSATION = {
  id: 42,
  is_group: true,
  group_name: 'Garden helpers',
  participant_count: 3,
  participants: [
    { id: 1, name: 'Ada Admin', role: 'admin' },
    { id: 2, name: 'Ben', role: 'member' },
    { id: 3, name: 'Cara', role: 'member' },
  ],
};

// The API returns newest first (direction=older, id DESC).
const PAGE_1 = [
  { id: 12, conversation_id: 42, sender_id: 1, body: 'I can bring a spade.', created_at: '2026-10-27T10:02:00Z', sender: { id: 1, name: 'Ada Admin' } },
  { id: 11, conversation_id: 42, sender_id: 2, body: 'Who is free on Saturday?', created_at: '2026-10-27T10:01:00Z', sender: { id: 2, name: 'Ben' } },
];
const OLDER = [
  { id: 10, conversation_id: 42, sender_id: 3, body: 'Welcome everyone!', created_at: '2026-10-26T09:00:00Z', sender: { id: 3, name: 'Cara' } },
];

function routeGets(overrides: Record<string, unknown> = {}) {
  mockApi.get.mockImplementation((url: string) => {
    for (const [prefix, value] of Object.entries(overrides)) {
      if (url.startsWith(prefix)) return Promise.resolve(value);
    }
    if (url === '/v2/messages/restriction-status') return Promise.resolve({ success: true, data: { messaging_disabled: false } });
    if (url.startsWith('/v2/messages/reactions/batch')) return Promise.resolve({ success: true, data: { reactions: { 12: [{ emoji: '👍', count: 2 }] } } });
    if (url.startsWith('/v2/conversations/42/messages') && url.includes('cursor=')) {
      return Promise.resolve({ success: true, data: OLDER, meta: { conversation: CONVERSATION, cursor: null, has_more: false, safeguarding: null } });
    }
    if (url.startsWith('/v2/conversations/42/messages')) {
      return Promise.resolve({ success: true, data: PAGE_1, meta: { conversation: CONVERSATION, cursor: 'MTE=', has_more: true, safeguarding: null } });
    }
    return Promise.resolve({ success: false });
  });
}

describe('GroupConversationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatures.direct_messaging = true;
    routeGets();
  });

  it('shows the group name and its messages, oldest first, with sender names', async () => {
    render(<GroupConversationPage />);

    expect(await screen.findByRole('heading', { name: 'Garden helpers' })).toBeInTheDocument();
    const first = await screen.findByText('Who is free on Saturday?');
    const second = screen.getByText('I can bring a spade.');
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Ben')).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith('/v2/conversations/42/messages?per_page=50');
  });

  it('loads older messages with the cursor the server returned', async () => {
    const user = userEvent.setup();
    render(<GroupConversationPage />);
    await screen.findByText('Who is free on Saturday?');

    await user.click(screen.getByRole('button', { name: 'Show older messages' }));

    expect(await screen.findByText('Welcome everyone!')).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith('/v2/conversations/42/messages?per_page=50&cursor=MTE%3D');
    expect(screen.queryByRole('button', { name: 'Show older messages' })).not.toBeInTheDocument();
  });

  it('sends a message to the group and shows it', async () => {
    mockApi.post.mockResolvedValue({
      success: true,
      data: { id: 13, conversation_id: 42, sender_id: 1, body: 'See you there', created_at: '2026-10-27T10:05:00Z', sender: { id: 1, name: 'Ada Admin' } },
    });
    render(<GroupConversationPage />);
    await screen.findByText('Who is free on Saturday?');

    const box = screen.getByRole('textbox', { name: 'Message the group' });
    fireEvent.change(box, { target: { value: 'See you there' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/v2/conversations/42/messages', { body: 'See you there' }));
    expect(await screen.findByText('See you there')).toBeInTheDocument();
  });

  it('shows the server safeguarding notice and no composer when the group is restricted', async () => {
    routeGets({
      '/v2/conversations/42/messages': {
        success: true,
        data: PAGE_1,
        meta: {
          conversation: CONVERSATION,
          cursor: null,
          has_more: false,
          safeguarding: { restricted: true, code: 'SAFEGUARDING_CONTACT_RESTRICTED', title: 'Contact is limited', detail: 'A coordinator must approve contact with one member.' },
        },
      },
    });
    render(<GroupConversationPage />);

    expect(await screen.findByText('Contact is limited')).toBeInTheDocument();
    expect(screen.getByText('A coordinator must approve contact with one member.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message the group' })).not.toBeInTheDocument();
  });

  it('switches to the safeguarding notice when a send is refused for safeguarding', async () => {
    mockApi.post.mockResolvedValue({
      success: false,
      code: 'VETTING_REQUIRED',
      error: 'You need a check first.',
      errors: [{ code: 'VETTING_REQUIRED', message: 'You need a check first.', title: 'A check is needed' }],
    });
    render(<GroupConversationPage />);
    await screen.findByText('Who is free on Saturday?');

    fireEvent.change(screen.getByRole('textbox', { name: 'Message the group' }), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('A check is needed')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message the group' })).not.toBeInTheDocument();
  });

  it('shows an error toast and keeps the text when a send fails for another reason', async () => {
    mockApi.post.mockResolvedValue({ success: false, code: 'REQUEST_FAILED' });
    render(<GroupConversationPage />);
    await screen.findByText('Who is free on Saturday?');

    const box = screen.getByRole('textbox', { name: 'Message the group' });
    fireEvent.change(box, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Failed to send message. Please try again.'));
    expect(box).toHaveValue('Hello');
  });

  it('offers no composer when messaging is restricted for the account', async () => {
    routeGets({ '/v2/messages/restriction-status': { success: true, data: { messaging_disabled: true } } });
    render(<GroupConversationPage />);
    await screen.findByText('Who is free on Saturday?');

    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Message the group' })).not.toBeInTheDocument());
  });

  it('lets a former member read but not send', async () => {
    routeGets({
      '/v2/conversations/42/messages': {
        success: true,
        data: PAGE_1,
        meta: { conversation: { ...CONVERSATION, participants: CONVERSATION.participants.filter((p) => p.id !== 1) }, cursor: null, has_more: false, safeguarding: null },
      },
    });
    render(<GroupConversationPage />);

    expect(await screen.findByText('Who is free on Saturday?')).toBeInTheDocument();
    expect(screen.getByText(/You are no longer a member of this group/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message the group' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Members' })).not.toBeInTheDocument();
  });

  it('opens the members dialog and returns to messages after leaving', async () => {
    const user = userEvent.setup();
    render(<GroupConversationPage />);
    await screen.findByText('Who is free on Saturday?');

    await user.click(screen.getByRole('button', { name: 'Members' }));
    await user.click(await screen.findByRole('button', { name: 'stub-leave' }));

    expect(mockNavigate).toHaveBeenCalledWith('/test/messages?tab=groups');
  });

  it('says the group cannot be found when the server refuses access', async () => {
    routeGets({ '/v2/conversations/42/messages': { success: false, code: 'FORBIDDEN' } });
    render(<GroupConversationPage />);

    expect(await screen.findByText('This group chat could not be found, or you are not a member.')).toBeInTheDocument();
  });

  it('toggles a reaction through the shared reaction endpoint', async () => {
    mockApi.post.mockResolvedValue({ success: true, data: { action: 'removed', emoji: '👍' } });
    const user = userEvent.setup();
    render(<GroupConversationPage />);
    await screen.findByText('I can bring a spade.');

    const existing = await screen.findByRole('button', { name: /👍/ });
    await user.click(existing);

    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/v2/messages/12/reactions', { emoji: '👍' }));
  });
});
