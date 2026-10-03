// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The safeguarding panels inside the broker panel (AdminEmbed): they keep
 * themselves current through the broker auto-refresh, reload without
 * flashing, open members through the host's member window, and show the
 * broker empty state. Outside the embed (the admin panel) none of that
 * happens — the admin panel must look exactly as before.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const mockUseBrokerAutoRefresh = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/broker/useBrokerAutoRefresh', () => ({ useBrokerAutoRefresh: mockUseBrokerAutoRefresh }));
vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
  }),
);
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// HeroUI's Table virtualises; a plain table keeps the rows readable in jsdom.
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...actual,
    Table: ({ children, removeWrapper: _r, ...props }: React.HTMLAttributes<HTMLTableElement> & { removeWrapper?: boolean }) =>
      <table {...props}>{children}</table>,
    TableHeader: ({ children }: { children?: React.ReactNode }) => <thead><tr>{children}</tr></thead>,
    TableColumn: ({ children }: { children?: React.ReactNode }) => <th>{children}</th>,
    TableBody: ({ children, emptyContent }: { children?: React.ReactNode; emptyContent?: React.ReactNode }) =>
      <tbody>{React.Children.count(children) === 0 ? <tr><td>{emptyContent}</td></tr> : children}</tbody>,
    TableRow: ({ children }: { children?: React.ReactNode }) => <tr>{children}</tr>,
    TableCell: ({ children }: { children?: React.ReactNode }) => <td>{children}</td>,
    Avatar: ({ name }: { name?: string }) => <span data-testid="avatar" aria-label={name} />,
    Spinner: () => <div data-testid="admin-spinner" role="status" aria-busy="true" />,
  };
});

import { AdminEmbed } from '@/admin/components/AdminEmbedContext';
import { GuardiansPanel } from './GuardiansPanel';
import { MemberSupportNeedsPanel } from './MemberSupportNeedsPanel';

const ok = (data: unknown) => ({ success: true, data });

const assignment = (overrides = {}) => ({
  id: 1,
  ward: { id: 201, name: 'Ward User', avatar_url: null },
  guardian: { id: 202, name: 'Guardian User', avatar_url: null },
  status: 'active' as const,
  consent_given: true,
  created_at: '2026-01-01T12:00:00Z',
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('GuardiansPanel inside the broker panel (AdminEmbed)', () => {
  it('subscribes to the broker auto-refresh, and a refresh keeps the rows on screen', async () => {
    mockApi.get.mockResolvedValue(ok({ assignments: [assignment()] }));
    render(
      <AdminEmbed>
        <GuardiansPanel />
      </AdminEmbed>,
    );
    await screen.findByText('Ward User');
    // The hook runs on every render (mocked here), so count subscriptions, not calls.
    expect(mockUseBrokerAutoRefresh).toHaveBeenCalled();
    expect(mockApi.get).toHaveBeenCalledTimes(1);

    // The quiet reload the auto-refresh was given.
    const reload = mockUseBrokerAutoRefresh.mock.calls[mockUseBrokerAutoRefresh.mock.calls.length - 1]?.[0] as () => void;
    mockApi.get.mockResolvedValue(ok({ assignments: [assignment({ ward: { id: 203, name: 'Second Ward', avatar_url: null } })] }));
    await act(async () => {
      reload();
    });
    // No skeleton or spinner replaced the table while the new rows loaded.
    expect(screen.queryByTestId('admin-spinner')).not.toBeInTheDocument();
    await screen.findByText('Second Ward');
    expect(mockApi.get).toHaveBeenCalledTimes(2);
  });

  it('shows the broker skeleton, not a spinner, while first loading', () => {
    mockApi.get.mockReturnValue(new Promise(() => undefined));
    render(
      <AdminEmbed>
        <GuardiansPanel />
      </AdminEmbed>,
    );
    expect(screen.getByRole('status', { name: 'Loading...' })).toBeInTheDocument();
    expect(screen.queryByTestId('admin-spinner')).not.toBeInTheDocument();
  });

  it('opens a member through the host member window when a name is pressed', async () => {
    mockApi.get.mockResolvedValue(ok({ assignments: [assignment()] }));
    const onOpenMember = vi.fn();
    render(
      <AdminEmbed>
        <GuardiansPanel onOpenMember={onOpenMember} />
      </AdminEmbed>,
    );
    fireEvent.click(await screen.findByRole('button', { name: "Open Guardian User's record" }));
    expect(onOpenMember).toHaveBeenCalledWith(202);
    fireEvent.click(screen.getByRole('button', { name: "Open Ward User's record" }));
    expect(onOpenMember).toHaveBeenCalledWith(201);
  });

  it('shows the broker empty state with a hint when there is nothing to list', async () => {
    mockApi.get.mockResolvedValue(ok({ assignments: [] }));
    render(
      <AdminEmbed>
        <GuardiansPanel />
      </AdminEmbed>,
    );
    expect(await screen.findByText('No guardian assignments')).toBeInTheDocument();
    expect(screen.getByText('When staff record a guardian arrangement for a member, it is listed here.')).toBeInTheDocument();
  });
});

describe('GuardiansPanel in the admin panel (no embed)', () => {
  it('does not subscribe to the broker auto-refresh and keeps names as plain text', async () => {
    mockApi.get.mockResolvedValue(ok({ assignments: [assignment()] }));
    render(<GuardiansPanel />);
    await screen.findByText('Ward User');
    expect(mockUseBrokerAutoRefresh).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /record/ })).not.toBeInTheDocument();
  });

  it('keeps its spinner and its one-line empty text', async () => {
    mockApi.get.mockReturnValue(new Promise(() => undefined));
    const { unmount } = render(<GuardiansPanel />);
    expect(screen.getByTestId('admin-spinner')).toBeInTheDocument();
    unmount();

    mockApi.get.mockResolvedValue(ok({ assignments: [] }));
    render(<GuardiansPanel />);
    expect(await screen.findByText('No guardian assignments')).toBeInTheDocument();
    expect(screen.queryByText(/When staff record a guardian arrangement/)).not.toBeInTheDocument();
  });
});

describe('MemberSupportNeedsPanel inside the broker panel (AdminEmbed)', () => {
  const need = {
    user_id: 301,
    user_name: 'Margaret Donegan',
    user_avatar: null,
    consent_given_at: '2026-05-21T10:00:00Z',
    options: [{ option_key: 'vetted_only', label: 'Only vetted members, please', is_declination: false }],
    has_triggers: true,
    is_declination_only: false,
    protections: ['requires_vetted_interaction'],
    seen_at: null,
    seen_by_name: null,
    needs_review: true,
  };

  it('refreshes quietly after a change elsewhere (the member window, a mark-seen) without a loading flash', async () => {
    mockApi.get.mockResolvedValue(ok([need]));
    render(
      <AdminEmbed>
        <MemberSupportNeedsPanel onOpenMember={vi.fn()} />
      </AdminEmbed>,
    );
    await screen.findByText('Margaret Donegan');
    const reload = mockUseBrokerAutoRefresh.mock.calls[mockUseBrokerAutoRefresh.mock.calls.length - 1]?.[0] as () => void;

    mockApi.get.mockResolvedValue(ok([{ ...need, user_id: 302, user_name: 'Second Member' }]));
    await act(async () => {
      reload();
    });
    expect(screen.queryByTestId('admin-spinner')).not.toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading...' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Second Member')).toBeInTheDocument());
  });
});
