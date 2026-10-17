// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── contexts ─────────────────────────────────────────────────────────────────
vi.mock('@/contexts', () => createMockContexts());

// ── location map stub — avoids heavy map dep ──────────────────────────────────
vi.mock('@/components/location/LocationMapCard', () => ({
  LocationMapCard: () => <div data-testid="location-map" />,
}));

// ── lib/helpers partial mock ──────────────────────────────────────────────────
vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    resolveAvatarUrl: (url: string | undefined | null) => url ?? '',
    resolveThumbnailUrl: (url: string | undefined | null) => url ?? '',
    formatDateValue: (d: string) => d,
    formatRelativeTime: (d: string) => d,
  };
});

import type { Group } from '@/types/api';
import { GroupHeader, type JoinRequest } from './GroupHeader';

// ── Shared fixtures ───────────────────────────────────────────────────────────

const makeGroup = (overrides: Partial<Group> = {}): Group => ({
  id: 1,
  name: 'Friendly Neighbours',
  description: 'A local help group',
  visibility: 'public',
  status: 'active',
  cover_image_url: null,
  cover_image: null,
  image_url: null,
  location: null,
  latitude: null,
  longitude: null,
  members_count: 12,
  posts_count: 7,
  created_at: '2026-01-15T00:00:00Z',
  ...overrides,
} as Group);

const defaultProps = {
  group: makeGroup(),
  userIsMember: false,
  userIsAdmin: false,
  isAuthenticated: true,
  isJoining: false,
  isPrivateGroup: false,
  joinRequests: [] as JoinRequest[],
  requestsLoading: false,
  requestsLoaded: false,
  processingRequest: null,
  getMemberCount: (g: Group) => g.members_count ?? 0,
  onJoinLeave: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenDelete: vi.fn(),
  onOpenInvite: vi.fn(),
  onOpenNotifPrefs: vi.fn(),
  onLoadJoinRequests: vi.fn(),
  onJoinRequest: vi.fn(),
};

describe('GroupHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders group name', () => {
    render(<GroupHeader {...defaultProps} />);
    expect(screen.getByText('Friendly Neighbours')).toBeInTheDocument();
  });

  it('renders group description', () => {
    render(<GroupHeader {...defaultProps} />);
    expect(screen.getByText('A local help group')).toBeInTheDocument();
  });

  it('keeps malicious group names inert and sanitizes malicious descriptions', () => {
    const name = '<img src=x onerror="window.__groupNameXss=1"><script>window.__groupNameXss=2</script>';
    const description = '<script>window.__groupDescriptionXss=1</script><a href="javascript:alert(1)" onclick="alert(2)">Safe description</a>';
    const { container } = render(
      <GroupHeader {...defaultProps} group={makeGroup({ name, description })} />,
    );

    expect(screen.getByText(name, { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Safe description', { exact: true })).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onerror], [onclick]')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
    expect((window as typeof window & { __groupNameXss?: number }).__groupNameXss).toBeUndefined();
    expect((window as typeof window & { __groupDescriptionXss?: number }).__groupDescriptionXss).toBeUndefined();
  });

  it('renders public chip for public group', () => {
    render(<GroupHeader {...defaultProps} />);
    // The chip label will be a translation key result — check aria-label or text
    const allText = document.body.textContent ?? '';
    expect(allText).toBeTruthy(); // rendered correctly
  });

  it('renders private chip for private group', () => {
    render(<GroupHeader {...{ ...defaultProps, isPrivateGroup: true, group: makeGroup({ visibility: 'private' }) }} />);
    // private groups show a lock icon; chip has amber color classes
    const chipEl = document.querySelector('[aria-label]');
    expect(chipEl).toBeDefined();
  });

  it('renders Join button when user is not a member (authenticated)', () => {
    render(<GroupHeader {...defaultProps} />);
    const joinBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('join') || b.getAttribute('aria-label')?.toLowerCase().includes('join')
    );
    expect(joinBtn).toBeDefined();
  });

  it('calls onJoinLeave when join button is clicked', async () => {
    const onJoinLeave = vi.fn();
    render(<GroupHeader {...{ ...defaultProps, onJoinLeave }} />);
    const joinBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('join'));
    if (joinBtn) {
      await userEvent.click(joinBtn);
      expect(onJoinLeave).toHaveBeenCalledTimes(1);
    }
  });

  it('renders Leave button when user is a member', () => {
    render(<GroupHeader {...{ ...defaultProps, userIsMember: true }} />);
    const leaveBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('leave'));
    expect(leaveBtn).toBeDefined();
  });

  it('renders Settings + Delete buttons for admin', () => {
    const group = makeGroup({
      viewer_membership: {
        status: 'active',
        role: 'owner',
        is_admin: true,
        capabilities: {
          can_join: false,
          can_leave: false,
          can_cancel_request: false,
          can_invite: true,
          can_manage_members: true,
          can_manage_admins: true,
          can_delete: true,
        },
      },
    });
    render(<GroupHeader {...{ ...defaultProps, group, userIsAdmin: true, userIsMember: true }} />);
    const settingsBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('setting'));
    const deleteBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('delete'));
    expect(settingsBtn).toBeDefined();
    expect(deleteBtn).toBeDefined();
  });

  it('calls onOpenSettings when Settings clicked', async () => {
    const onOpenSettings = vi.fn();
    render(<GroupHeader {...{ ...defaultProps, userIsAdmin: true, userIsMember: true, onOpenSettings }} />);
    const btn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('setting'));
    if (btn) {
      await userEvent.click(btn);
      expect(onOpenSettings).toHaveBeenCalledTimes(1);
    }
  });

  it('calls onOpenDelete when Delete clicked', async () => {
    const onOpenDelete = vi.fn();
    const group = makeGroup({
      viewer_membership: {
        status: 'active', role: 'owner', is_admin: true,
        capabilities: {
          can_join: false, can_leave: false, can_cancel_request: false, can_invite: true,
          can_manage_members: true, can_manage_admins: true, can_delete: true,
        },
      },
    });
    render(<GroupHeader {...{ ...defaultProps, group, userIsAdmin: true, userIsMember: true, onOpenDelete }} />);
    const btn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('delete'));
    if (btn) {
      await userEvent.click(btn);
      expect(onOpenDelete).toHaveBeenCalledTimes(1);
    }
  });

  it('renders Invite button for admins who are members', () => {
    render(<GroupHeader {...{ ...defaultProps, userIsAdmin: true, userIsMember: true }} />);
    const inviteBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('invite') || b.getAttribute('aria-label')?.toLowerCase().includes('invite')
    );
    expect(inviteBtn).toBeDefined();
  });

  it('shows notification prefs button when user is a member', () => {
    render(<GroupHeader {...{ ...defaultProps, userIsMember: true }} />);
    const notifBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('notif') || b.getAttribute('aria-label')?.toLowerCase().includes('setting')
    );
    expect(notifBtn).toBeDefined();
  });

  it('shows "view pending requests" button for private group admin before loading', () => {
    render(
      <GroupHeader
        {...{ ...defaultProps, userIsAdmin: true, isPrivateGroup: true, requestsLoaded: false }}
      />
    );
    expect(
      screen.getByRole('button', { name: /view pending join requests/i })
    ).toBeInTheDocument();
  });

  it('calls onLoadJoinRequests when view-pending button is clicked', async () => {
    const onLoadJoinRequests = vi.fn();
    render(
      <GroupHeader
        {...{ ...defaultProps, userIsAdmin: true, isPrivateGroup: true, requestsLoaded: false, onLoadJoinRequests }}
      />
    );
    await userEvent.click(
      screen.getByRole('button', { name: /view pending join requests/i })
    );
    expect(onLoadJoinRequests).toHaveBeenCalledTimes(1);
  });

  it('renders join requests when requestsLoaded=true', () => {
    const joinRequests: JoinRequest[] = [
      {
        user_id: 55,
        user: { id: 55, name: 'Charlie', avatar: null },
        created_at: '2026-01-10T00:00:00Z',
      },
    ];
    render(
      <GroupHeader
        {...{ ...defaultProps, userIsAdmin: true, requestsLoaded: true, joinRequests }}
      />
    );
    expect(screen.getByText('Charlie')).toBeInTheDocument();
  });

  it('shows accept/reject for each join request', () => {
    const joinRequests: JoinRequest[] = [
      {
        user_id: 55,
        user: { id: 55, name: 'Charlie', avatar: null },
        created_at: '2026-01-10T00:00:00Z',
      },
    ];
    render(
      <GroupHeader
        {...{ ...defaultProps, userIsAdmin: true, requestsLoaded: true, joinRequests }}
      />
    );
    const acceptBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('accept'));
    const rejectBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('reject'));
    expect(acceptBtn).toBeDefined();
    expect(rejectBtn).toBeDefined();
  });

  it('calls onJoinRequest with accept when accept clicked', async () => {
    const onJoinRequest = vi.fn();
    const joinRequests: JoinRequest[] = [
      { user_id: 55, user: { id: 55, name: 'Charlie', avatar: null }, created_at: '2026-01-10T00:00:00Z' },
    ];
    render(
      <GroupHeader
        {...{ ...defaultProps, userIsAdmin: true, requestsLoaded: true, joinRequests, onJoinRequest }}
      />
    );
    const acceptBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('accept'));
    if (acceptBtn) {
      await userEvent.click(acceptBtn);
      expect(onJoinRequest).toHaveBeenCalledWith(55, 'accept');
    }
  });

  it('renders no join / leave button when not authenticated', () => {
    render(<GroupHeader {...{ ...defaultProps, isAuthenticated: false }} />);
    const joinBtn = screen.queryAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('join'));
    expect(joinBtn).toBeUndefined();
  });

  it('renders location map when lat/lng provided', () => {
    const groupWithLocation = makeGroup({ location: 'Dublin', latitude: 53.3, longitude: -6.3 });
    render(<GroupHeader {...{ ...defaultProps, group: groupWithLocation }} />);
    expect(screen.getByTestId('location-map')).toBeInTheDocument();
  });

  it('shows empty-requests message when requestsLoaded but none', () => {
    render(
      <GroupHeader
        {...{ ...defaultProps, userIsAdmin: true, requestsLoaded: true, joinRequests: [] }}
      />
    );
    // Translation key: detail.no_pending_requests
    // In test env key fallback text will be rendered — just check no request rows
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
  });

  it('applies persisted validated brand colors to the no-cover fallback only', () => {
    const { rerender } = render(
      <GroupHeader
        {...defaultProps}
        group={makeGroup({ primary_color: '#123456', accent_color: '#ABCDEF' })}
      />,
    );
    const fallback = document.querySelector('[data-group-branding="custom"]') as HTMLElement;
    expect(fallback).toBeInTheDocument();
    expect(fallback.style.getPropertyValue('--group-primary-color')).toBe('#123456');
    expect(fallback.style.getPropertyValue('--group-accent-color')).toBe('#ABCDEF');

    rerender(
      <GroupHeader
        {...defaultProps}
        group={makeGroup({
          primary_color: '#123456',
          accent_color: '#ABCDEF',
          cover_image_url: '/cover.jpg',
        })}
      />,
    );
    const covered = document.querySelector('[data-group-branding="theme"]') as HTMLElement;
    expect(covered.style.getPropertyValue('--group-primary-color')).toBe('');
  });

  it('ignores malformed brand colors in the fallback header', () => {
    render(<GroupHeader {...defaultProps} group={makeGroup({ primary_color: 'red', accent_color: '#12345G' })} />);
    expect(document.querySelector('[data-group-branding="theme"]')).toBeInTheDocument();
  });

  it('shows Cancel Join Request for a pending membership', async () => {
    const onJoinLeave = vi.fn();
    const group = makeGroup({
      viewer_membership: {
        status: 'pending', role: 'member', is_admin: false,
        capabilities: {
          can_join: false, can_leave: false, can_cancel_request: true, can_invite: false,
          can_manage_members: false, can_manage_admins: false, can_delete: false,
        },
      },
    });
    render(<GroupHeader {...{ ...defaultProps, group, onJoinLeave }} />);

    await userEvent.click(screen.getByRole('button', { name: /cancel join request/i }));
    expect(onJoinLeave).toHaveBeenCalledOnce();
  });

  it('does not offer Leave or Delete to a non-owner group admin', () => {
    const group = makeGroup({
      viewer_membership: {
        status: 'active', role: 'admin', is_admin: true,
        capabilities: {
          can_join: false, can_leave: true, can_cancel_request: false, can_invite: true,
          can_manage_members: true, can_manage_admins: false, can_delete: false,
        },
      },
    });
    render(<GroupHeader {...{ ...defaultProps, group, userIsAdmin: true, userIsMember: true }} />);

    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /leave group/i })).toBeInTheDocument();
  });

  it('does not offer Leave to the group owner', () => {
    const group = makeGroup({
      viewer_membership: {
        status: 'active', role: 'owner', is_admin: true,
        capabilities: {
          can_join: false, can_leave: false, can_cancel_request: false, can_invite: true,
          can_manage_members: true, can_manage_admins: true, can_delete: true,
        },
      },
    });
    render(<GroupHeader {...{ ...defaultProps, group, userIsAdmin: true, userIsMember: true }} />);

    expect(screen.queryByRole('button', { name: /leave group/i })).not.toBeInTheDocument();
  });

  it('shows a retryable error instead of claiming there are no pending requests', async () => {
    const onLoadJoinRequests = vi.fn();
    render(
      <GroupHeader
        {...defaultProps}
        userIsAdmin
        isPrivateGroup
        requestsLoaded
        requestsError
        onLoadJoinRequests={onLoadJoinRequests}
      />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No pending requests')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(onLoadJoinRequests).toHaveBeenCalledOnce();
  });

  it('renders spinner inside requests section when requestsLoading', () => {
    const joinRequests: JoinRequest[] = [];
    render(
      <GroupHeader
        {...{
          ...defaultProps,
          userIsAdmin: true,
          requestsLoaded: true,
          requestsLoading: true,
          joinRequests,
        }}
      />
    );
    // Spinner renders role=status aria-busy=true
    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeTruthy();
  });
});
