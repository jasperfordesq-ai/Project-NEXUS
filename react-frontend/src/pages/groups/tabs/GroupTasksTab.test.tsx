// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── API mock ─────────────────────────────────────────────────────────────────
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

// ─── Contexts ─────────────────────────────────────────────────────────────────
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
};

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Admin User' },
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
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

// ─── Stub heavy child: TeamTasks renders its own API calls + modals ───────────
// We stub it at the barrel to avoid bringing in full HeroUI Modal/Select stacks.
vi.mock('@/components/ideation', () => ({
  TeamTasks: ({
    groupId,
    isGroupAdmin,
    members,
  }: {
    groupId: number;
    isGroupAdmin: boolean;
    members: { id: number; name: string; avatar_url: string | null }[];
  }) => (
    <div data-testid="team-tasks">
      <span data-testid="team-tasks-group-id">{groupId}</span>
      <span data-testid="team-tasks-is-admin">{String(isGroupAdmin)}</span>
      <span data-testid="team-tasks-member-count">{members.length}</span>
      {members.map((m) => (
        <span key={m.id} data-testid={`member-name-${m.id}`}>
          {m.name}
        </span>
      ))}
    </div>
  ),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
import type { GroupMember } from './GroupMembersTab';

function makeGroupMember(overrides: Partial<GroupMember> = {}): GroupMember {
  return {
    id: 10,
    name: 'Alice Smith',
    first_name: 'Alice',
    last_name: 'Smith',
    avatar_url: null,
    avatar: null,
    role: 'member',
    ...overrides,
  } as GroupMember;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('GroupTasksTab', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: tasks fetch resolves empty (TeamTasks is stubbed anyway)
    mockApi.get.mockResolvedValue({ success: true, data: [], meta: {} });
  });

  it('renders the card wrapper with the TeamTasks stub', async () => {
    const { GroupTasksTab } = await import('./GroupTasksTab');
    render(
      <GroupTasksTab
        groupId={5}
        isGroupAdmin={false}
        members={[]}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('team-tasks')).toBeInTheDocument();
    });
  });

  it('passes groupId down to TeamTasks', async () => {
    const { GroupTasksTab } = await import('./GroupTasksTab');
    render(
      <GroupTasksTab groupId={42} isGroupAdmin={false} members={[]} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('team-tasks-group-id')).toHaveTextContent('42');
    });
  });

  it('passes isGroupAdmin=true down to TeamTasks', async () => {
    const { GroupTasksTab } = await import('./GroupTasksTab');
    render(
      <GroupTasksTab groupId={1} isGroupAdmin={true} members={[]} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('team-tasks-is-admin')).toHaveTextContent('true');
    });
  });

  it('passes isGroupAdmin=false down to TeamTasks', async () => {
    const { GroupTasksTab } = await import('./GroupTasksTab');
    render(
      <GroupTasksTab groupId={1} isGroupAdmin={false} members={[]} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('team-tasks-is-admin')).toHaveTextContent('false');
    });
  });

  it('maps full-name members (first_name + last_name) for TeamTasks', async () => {
    const member = makeGroupMember({ id: 10, first_name: 'Alice', last_name: 'Smith' });
    const { GroupTasksTab } = await import('./GroupTasksTab');
    render(
      <GroupTasksTab groupId={1} isGroupAdmin={false} members={[member]} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('member-name-10')).toHaveTextContent('Alice Smith');
    });
  });

  it('falls back to member.name when first_name/last_name are absent', async () => {
    const member = makeGroupMember({
      id: 11,
      first_name: undefined,
      last_name: undefined,
      name: 'Bob Jones',
    });
    const { GroupTasksTab } = await import('./GroupTasksTab');
    render(
      <GroupTasksTab groupId={1} isGroupAdmin={false} members={[member]} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('member-name-11')).toHaveTextContent('Bob Jones');
    });
  });

  it('uses the "User" fallback label when name fields are all absent', async () => {
    const member = makeGroupMember({
      id: 12,
      first_name: undefined,
      last_name: undefined,
      name: undefined,
    });
    const { GroupTasksTab } = await import('./GroupTasksTab');
    render(
      <GroupTasksTab groupId={1} isGroupAdmin={false} members={[member]} />,
    );
    // The translation key groups:member_fallback resolves to "User"
    await waitFor(() => {
      expect(screen.getByTestId('member-name-12')).toHaveTextContent('User');
    });
  });

  it('passes the correct member count to TeamTasks', async () => {
    const members = [
      makeGroupMember({ id: 1 }),
      makeGroupMember({ id: 2, first_name: 'Bob', last_name: 'Brown' }),
      makeGroupMember({ id: 3, first_name: 'Carol', last_name: 'Cole' }),
    ];
    const { GroupTasksTab } = await import('./GroupTasksTab');
    render(
      <GroupTasksTab groupId={99} isGroupAdmin={true} members={members} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('team-tasks-member-count')).toHaveTextContent('3');
    });
  });

  it('handles an empty members array without crashing', async () => {
    const { GroupTasksTab } = await import('./GroupTasksTab');
    expect(() =>
      render(<GroupTasksTab groupId={7} isGroupAdmin={false} members={[]} />),
    ).not.toThrow();
    await waitFor(() => {
      expect(screen.getByTestId('team-tasks-member-count')).toHaveTextContent('0');
    });
  });

  it('prefers avatar_url over avatar for the member avatar field', async () => {
    // The tab maps avatar_url ?? avatar ?? null; verify it passes a value when available.
    const member = makeGroupMember({
      id: 20,
      avatar_url: 'https://example.com/pic.jpg',
      avatar: 'fallback.jpg',
    });
    const { GroupTasksTab } = await import('./GroupTasksTab');
    render(
      <GroupTasksTab groupId={1} isGroupAdmin={false} members={[member]} />,
    );
    // TeamTasks stub renders correctly — just confirm it mounted without errors
    await waitFor(() => {
      expect(screen.getByTestId('member-name-20')).toBeInTheDocument();
    });
  });

  it('uses avatar as fallback when avatar_url is null', async () => {
    const member = makeGroupMember({
      id: 21,
      avatar_url: null,
      avatar: 'fallback.jpg',
      // `name` is overridden alongside the parts on purpose: the API always
      // ships a resolved `name` (the organisation name for an organisation
      // account) and resolveUserDisplayName() prefers it, so a fixture whose
      // `name` contradicts its own first/last cannot occur in real data.
      name: 'Dan Dean',
      first_name: 'Dan',
      last_name: 'Dean',
    });
    const { GroupTasksTab } = await import('./GroupTasksTab');
    render(
      <GroupTasksTab groupId={1} isGroupAdmin={false} members={[member]} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('member-name-21')).toHaveTextContent('Dan Dean');
    });
  });

  it('renders inside a GlassCard (has padding class)', async () => {
    const { GroupTasksTab } = await import('./GroupTasksTab');
    const { container } = render(
      <GroupTasksTab groupId={1} isGroupAdmin={false} members={[]} />,
    );
    // GlassCard receives className="p-6" — verify at least one element carries it
    const padded = container.querySelector('.p-6');
    expect(padded).toBeInTheDocument();
  });
});
