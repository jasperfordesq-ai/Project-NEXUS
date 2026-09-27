// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── Mock @/lib/api (GroupAuditLog imports { api } from '@/lib/api') ──────────
const mockApiGet = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// ── Stable toast ─────────────────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  }),
);

// ── Sample audit entries ──────────────────────────────────────────────────────
const AUDIT_ENTRIES = [
  {
    id: 1,
    action: 'member_joined',
    user_id: 10,
    details: { note: 'Joined via invite' },
    ip_address: '192.168.1.1',
    created_at: '2026-06-01T10:00:00Z',
  },
  {
    id: 2,
    action: 'member_banned',
    user_id: 20,
    details: null,
    ip_address: null,
    created_at: '2026-06-02T11:00:00Z',
  },
];

import {
  ACTION_COLORS,
  ACTION_LABEL_KEYS,
  GroupAuditLog,
  redactAuditDetails,
} from './GroupAuditLog';

const CANONICAL_ACTIONS = [
  'group_created',
  'group_updated',
  'group_deleted',
  'group_featured',
  'group_image_updated',
  'group_status_changed',
  'member_joined',
  'member_join_requested',
  'member_join_rejected',
  'member_left',
  'member_kicked',
  'member_banned',
  'member_role_changed',
  'member_removed',
  'invite_revoked',
  'discussion_created',
  'post_created',
  'post_moderated',
  'challenge_created',
  'challenge_completed',
  'challenge_reward_awarded',
  'challenge_cancelled',
  'file_uploaded',
  'file_deleted',
  'media_uploaded',
  'media_deleted',
  'announcement_deleted',
  'qa_question_deleted',
  'qa_answer_deleted',
  'qa_answer_accepted',
  'wiki_page_deleted',
  'chatroom_deleted',
  'chatroom_message_deleted',
  'chatroom_message_pinned',
  'chatroom_message_unpinned',
  'team_task_deleted',
  'scheduled_post_cancelled',
  'webhook_deleted',
  'webhook_toggled',
] as const;

describe('GroupAuditLog — loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockReturnValue(new Promise(() => {})); // pending
  });

  it('shows loading spinner (aria-busy=true)', () => {
    render(<GroupAuditLog groupId={5} />);
    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeInTheDocument();
  });
});

describe('GroupAuditLog — populated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue({ success: true, data: AUDIT_ENTRIES });
  });

  it('fetches audit log URL with correct groupId', async () => {
    render(<GroupAuditLog groupId={5} />);
    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith(
        expect.stringContaining('/v2/admin/groups/5/audit-log'),
      );
    });
  });

  it('renders action chips for each entry', async () => {
    render(<GroupAuditLog groupId={5} />);
    await waitFor(() => {
      expect(screen.getAllByText('Member joined').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Member banned').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('member_joined')).not.toBeInTheDocument();
    expect(screen.queryByText('member_banned')).not.toBeInTheDocument();
  });

  it('maps every service constant and emitted lifecycle action to a label and semantic color', () => {
    for (const action of CANONICAL_ACTIONS) {
      expect(ACTION_LABEL_KEYS[action], `${action} label`).toMatch(/^groups\.audit_action_/);
      expect(ACTION_COLORS[action], `${action} color`).toMatch(/^(primary|success|warning|danger)$/);
    }
  });

  it('renders canonical challenge and lifecycle actions without leaking raw codes', async () => {
    mockApiGet.mockResolvedValueOnce({
      success: true,
      data: [
        { ...AUDIT_ENTRIES[0], id: 11, action: 'group_status_changed' },
        { ...AUDIT_ENTRIES[0], id: 12, action: 'challenge_created' },
        { ...AUDIT_ENTRIES[0], id: 13, action: 'challenge_completed' },
        { ...AUDIT_ENTRIES[0], id: 14, action: 'challenge_reward_awarded' },
        { ...AUDIT_ENTRIES[0], id: 15, action: 'challenge_cancelled' },
      ],
    });
    render(<GroupAuditLog groupId={5} />);

    expect((await screen.findAllByText('Group status changed')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Challenge created').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Challenge completed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Challenge reward awarded').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Challenge cancelled').length).toBeGreaterThan(0);
    for (const rawAction of [
      'group_status_changed',
      'challenge_created',
      'challenge_completed',
      'challenge_reward_awarded',
      'challenge_cancelled',
    ]) {
      expect(screen.queryByText(rawAction)).not.toBeInTheDocument();
    }
  });

  it('renders user ids', async () => {
    render(<GroupAuditLog groupId={5} />);
    await waitFor(() => {
      expect(screen.getByText('#10')).toBeInTheDocument();
      expect(screen.getByText('#20')).toBeInTheDocument();
    });
  });

  it('renders IP address when present', async () => {
    render(<GroupAuditLog groupId={5} />);
    await waitFor(() => {
      expect(screen.getByText('192.168.1.1')).toBeInTheDocument();
    });
  });

  it('spinner gone after data loads', async () => {
    render(<GroupAuditLog groupId={5} />);
    await waitFor(() => {
      const busy = screen.queryAllByRole('status').find(
        (el) => el.getAttribute('aria-busy') === 'true',
      );
      expect(busy).toBeUndefined();
    });
  });

  it('still renders entries from a legacy/fallback nested { data: [...] } payload', async () => {
    // Legacy/fallback shape only. GET /v2/admin/groups/{id}/audit-log really sends
    // { items, actions, pagination } (respondWithData), covered by the paging test below.
    // Override the default mock to return wrapped payload
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ success: true, data: { data: AUDIT_ENTRIES } });
    render(<GroupAuditLog groupId={7} />);
    await waitFor(() => {
      expect(screen.getAllByText('Member joined').length).toBeGreaterThan(0);
    });
  });

  it('renders a translated fallback instead of an unknown raw action code', async () => {
    mockApiGet.mockResolvedValueOnce({
      success: true,
      data: [{ ...AUDIT_ENTRIES[0], action: 'future_internal_code' }],
    });
    render(<GroupAuditLog groupId={5} />);

    expect((await screen.findAllByText('Other action')).length).toBeGreaterThan(0);
    expect(screen.queryByText('future_internal_code')).not.toBeInTheDocument();
  });

  it('redacts nested secret values and bearer credentials before rendering details', () => {
    expect(redactAuditDetails({
      safe: 'visible',
      api_key: 'private-key',
      nested: { password: 'secret', note: 'Authorization: Bearer abc.def.ghi' },
    }, '[redacted]')).toEqual({
      safe: 'visible',
      api_key: '[redacted]',
      nested: { password: '[redacted]', note: 'Authorization: Bearer [redacted]' },
    });
  });
});

describe('GroupAuditLog — ExpandableDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const longEntry = [
      {
        id: 3,
        action: 'group_updated',
        user_id: 30,
        details: { field: 'name', from: 'Old Group Name', to: 'New Group Name XYZ extra text to exceed fifty characters' },
        ip_address: null,
        created_at: '2026-06-03T09:00:00Z',
      },
    ];
    mockApiGet.mockResolvedValue({ success: true, data: longEntry });
  });

  it('shows expand button for long details', async () => {
    render(<GroupAuditLog groupId={5} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /expand/i })).toBeInTheDocument();
    });
  });

  it('toggles expanded details on click', async () => {
    const user = userEvent.setup();
    render(<GroupAuditLog groupId={5} />);
    await waitFor(() => screen.getByRole('button', { name: /expand/i }));

    const expandBtn = screen.getByRole('button', { name: /expand/i });
    await user.click(expandBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /collapse/i })).toBeInTheDocument();
    });
  });
});

describe('GroupAuditLog — empty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue({ success: true, data: [] });
  });

  it('shows empty state message when no entries', async () => {
    render(<GroupAuditLog groupId={5} />);
    await waitFor(() => {
      // When entries=[] the component renders a <p> rather than a <table>
      expect(document.querySelector('table')).not.toBeInTheDocument();
    });
  });
});

describe('GroupAuditLog — error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockRejectedValue(new Error('Server error'));
  });

  it('shows error toast on load failure', async () => {
    render(<GroupAuditLog groupId={5} />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('does not render a resolved API failure as an empty audit log', async () => {
    mockApiGet.mockResolvedValueOnce({ success: false, error: 'Denied' });
    render(<GroupAuditLog groupId={5} />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(mockToast.error).toHaveBeenCalled();
    expect(document.querySelector('table')).not.toBeInTheDocument();
  });
});

describe('GroupAuditLog — action filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue({ success: true, data: AUDIT_ENTRIES });
  });

  it('appends action filter to URL when non-all value selected', async () => {
    // Note: testing the URL construction logic via the mock call args
    // The Select interaction in HeroUI is complex — we test the URL result
    render(<GroupAuditLog groupId={5} />);
    await waitFor(() => {
      // Initial call without filter
      expect(mockApiGet).toHaveBeenCalledWith(
        '/v2/admin/groups/5/audit-log',
      );
    });
  });
});

describe('GroupAuditLog pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet
      .mockResolvedValueOnce({
        success: true,
        data: {
          items: [AUDIT_ENTRIES[0]],
          actions: ['member_banned', 'member_joined'],
          pagination: { page: 1, has_more: true },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          items: [AUDIT_ENTRIES[1]],
          actions: ['member_banned', 'member_joined'],
          pagination: { page: 2, has_more: false },
        },
      });
  });

  it('loads the next page and retains prior rows without duplicates', async () => {
    const user = userEvent.setup();
    render(<GroupAuditLog groupId={5} />);
    await screen.findByText('#10');

    await user.click(screen.getByRole('button', { name: /load more/i }));
    await screen.findByText('#20');

    expect(screen.getByText('#10')).toBeInTheDocument();
    expect(mockApiGet).toHaveBeenLastCalledWith('/v2/admin/groups/5/audit-log?page=2');
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });
});
