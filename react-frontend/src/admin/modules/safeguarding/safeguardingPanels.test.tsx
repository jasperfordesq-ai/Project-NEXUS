// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The safeguarding panels — each one a page of its own in the broker
 * panel since October 2026 (they were tabs of SafeguardingDashboard; its
 * flagged-messages tab became the Messages queue's "Urgent" view).
 * Cases carried over from the dashboard's tests, plus the new Members'
 * support needs behaviour: "not yet seen" by default, plain-English
 * protections, and Mark as seen.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return { ...actual, formatRelativeTime: (s: string) => s };
});

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// Plain-HTML stand-ins for HeroUI pieces whose React-Aria collection logic
// does not run under jsdom.
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
    Spinner: () => <div role="status" aria-busy="true" />,
    Card: ({ children, className }: { children?: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
    CardHeader: ({ children, className }: { children?: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
    CardBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Chip: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
    Separator: () => <hr />,
  };
});

const ok = (data: unknown) => ({ success: true, data });

const makeNeed = (overrides = {}) => ({
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
  ...overrides,
});

const makeAssignment = (overrides = {}) => ({
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
  // Panels keep their view in the URL; BrowserRouter would carry one test's
  // ?filter= / ?show= into the next.
  window.history.replaceState({}, '', '/');
});

// ─────────────────────────────────────────────────────────────────────────────
describe("MemberSupportNeedsPanel (Members' support needs)", () => {
  it('shows only members not yet seen by default, with what their answers change in plain words', async () => {
    mockApi.get.mockResolvedValue(ok([
      makeNeed(),
      makeNeed({ user_id: 302, user_name: 'Already Seen', needs_review: false, seen_at: '2026-06-01', seen_by_name: 'Bea Broker' }),
    ]));
    const { MemberSupportNeedsPanel } = await import('./MemberSupportNeedsPanel');
    render(<MemberSupportNeedsPanel />);

    expect(await screen.findByText('Margaret Donegan')).toBeInTheDocument();
    expect(screen.queryByText('Already Seen')).not.toBeInTheDocument();
    // The protection is named, using the same wording as the Safeguarding Options page.
    expect(screen.getByText('Vetted members only')).toBeInTheDocument();
    expect(screen.getByText(/Non-vetted members are hidden/)).toBeInTheDocument();
    expect(screen.getByText('Only vetted members, please')).toBeInTheDocument();
  });

  it('shows everyone, including who saw them, under "Everyone"', async () => {
    mockApi.get.mockResolvedValue(ok([
      makeNeed(),
      makeNeed({ user_id: 302, user_name: 'Already Seen', needs_review: false, seen_at: '2026-06-01', seen_by_name: 'Bea Broker' }),
    ]));
    const { MemberSupportNeedsPanel } = await import('./MemberSupportNeedsPanel');
    render(<MemberSupportNeedsPanel />);

    fireEvent.click(await screen.findByRole('radio', { name: /Everyone/ }));

    expect(await screen.findByText('Already Seen')).toBeInTheDocument();
    expect(screen.getByText(/Seen by Bea Broker/)).toBeInTheDocument();
  });

  it('marks a member as seen and drops them from the not-yet-seen list', async () => {
    mockApi.get.mockResolvedValue(ok([makeNeed()]));
    mockApi.post.mockResolvedValue(ok({ user_id: 301, seen_at: '2026-10-03 10:00:00', seen_by_name: 'Bea Broker' }));
    const refresh = vi.fn();
    window.addEventListener('nexus:broker-badges-refresh', refresh);
    const { MemberSupportNeedsPanel } = await import('./MemberSupportNeedsPanel');
    render(<MemberSupportNeedsPanel />);

    fireEvent.click(await screen.findByRole('button', { name: /Mark Margaret Donegan's support needs as seen/ }));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/safeguarding/member-preferences/301/seen');
    });
    expect(await screen.findByText(/You're up to date/)).toBeInTheDocument();
    expect(mockToast.success).toHaveBeenCalled();
    // The sidebar badge is told to update straight away.
    expect(refresh).toHaveBeenCalled();
    window.removeEventListener('nexus:broker-badges-refresh', refresh);
  });

  it('shows the server refusal instead of pretending the mark worked', async () => {
    mockApi.get.mockResolvedValue(ok([makeNeed()]));
    mockApi.post.mockResolvedValue({ success: false, error: 'You cannot close a safeguarding record about yourself.' });
    const { MemberSupportNeedsPanel } = await import('./MemberSupportNeedsPanel');
    render(<MemberSupportNeedsPanel />);

    fireEvent.click(await screen.findByRole('button', { name: /Mark Margaret Donegan's support needs as seen/ }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('You cannot close a safeguarding record about yourself.');
    });
    expect(screen.getByText('Margaret Donegan')).toBeInTheDocument();
  });

  it('opens the member when their name is pressed', async () => {
    mockApi.get.mockResolvedValue(ok([makeNeed()]));
    const onOpenMember = vi.fn();
    const { MemberSupportNeedsPanel } = await import('./MemberSupportNeedsPanel');
    render(<MemberSupportNeedsPanel onOpenMember={onOpenMember} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Margaret Donegan' }));
    expect(onOpenMember).toHaveBeenCalledWith(301);
  });

  it('shows just the member a safeguarding alert links to (?user=), until "Show everyone"', async () => {
    window.history.replaceState({}, '', '/?user=302');
    mockApi.get.mockResolvedValue(ok([
      makeNeed(),
      makeNeed({ user_id: 302, user_name: 'Already Seen', needs_review: false, seen_at: '2026-06-01', seen_by_name: 'Bea Broker' }),
    ]));
    const { MemberSupportNeedsPanel } = await import('./MemberSupportNeedsPanel');
    render(<MemberSupportNeedsPanel />);

    // Shown even though already seen, because the alert is about them.
    expect(await screen.findByText('Already Seen')).toBeInTheDocument();
    expect(screen.queryByText('Margaret Donegan')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show everyone' }));
    expect(await screen.findByText('Margaret Donegan')).toBeInTheDocument();
  });

  it('filters by name', async () => {
    mockApi.get.mockResolvedValue(ok([makeNeed(), makeNeed({ user_id: 303, user_name: 'Pat Other' })]));
    const { MemberSupportNeedsPanel } = await import('./MemberSupportNeedsPanel');
    render(<MemberSupportNeedsPanel />);

    await screen.findByText('Pat Other');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search members by name' }), { target: { value: 'marg' } });

    await waitFor(() => expect(screen.queryByText('Pat Other')).not.toBeInTheDocument());
    expect(screen.getByText('Margaret Donegan')).toBeInTheDocument();
  });

  it('says the list could not be loaded when the server refuses it, not that there are no members (F-542)', async () => {
    mockApi.get.mockResolvedValue({ success: false, error: 'Forbidden' });
    const { MemberSupportNeedsPanel } = await import('./MemberSupportNeedsPanel');
    render(<MemberSupportNeedsPanel />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GuardiansPanel', () => {
  it('lists active arrangements and revokes one', async () => {
    mockApi.get.mockResolvedValue(ok([makeAssignment()]));
    mockApi.delete.mockResolvedValue(ok({}));
    const { GuardiansPanel } = await import('./GuardiansPanel');
    render(<GuardiansPanel />);

    expect(await screen.findByText('Ward User')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Revoke/ }));

    await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('/v2/admin/safeguarding/assignments/1'));
  });

  it('shows the API error when creating an arrangement is refused', async () => {
    mockApi.get.mockResolvedValue(ok([]));
    mockApi.post.mockResolvedValue({ success: false, error: 'Supported member not found in this community' });
    const { GuardiansPanel } = await import('./GuardiansPanel');
    render(<GuardiansPanel />);

    const openButtons = await screen.findAllByRole('button', { name: /New Assignment/i });
    fireEvent.click(openButtons[0]!);
    const inputs = await screen.findAllByRole('textbox');
    fireEvent.change(inputs[0]!, { target: { value: 'ward@example.com' } });
    fireEvent.change(inputs[1]!, { target: { value: 'guardian@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Assignment/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Supported member not found in this community');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SupportActionsPanel', () => {
  it('records an offline approval through the attest modal', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('authority-attestations')) return Promise.resolve(ok({ relationships: [] }));
      return Promise.resolve(ok({
        actions: [{
          id: 71,
          action_type: 'credit_transfer',
          payload_summary: { amount: 3 },
          supported_name: 'Molly Member',
          supporter_name: 'Sam Supporter',
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        }],
      }));
    });
    mockApi.post.mockResolvedValue(ok({ status: 'confirmed' }));
    const { SupportActionsPanel } = await import('./SupportActionsPanel');
    render(<SupportActionsPanel />);

    fireEvent.click(await screen.findByRole('button', { name: /Record the member's yes/ }));
    expect(await screen.findByText(/member is told it was recorded/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Witness (optional)'), { target: { value: 'Nora Neighbour' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record yes and carry it out' }));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/safeguarding/support-actions/71/attest', {
        channel: 'phone',
        witness: 'Nora Neighbour',
      });
    });
  });

  it('shows each item as a card with its button on screen on a phone, not a sideways-scrolling table', async () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query === '(max-width: 767px)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('authority-attestations')) {
        return Promise.resolve(ok({
          relationships: [{ relationship_id: 9, supporter_name: 'Sam Supporter', supported_name: 'Molly Member', relationship_type: 'family', attestations: [] }],
        }));
      }
      return Promise.resolve(ok({
        actions: [{
          id: 71, action_type: 'credit_transfer', payload_summary: { amount: 3 },
          supported_name: 'Molly Member', supporter_name: 'Sam Supporter',
          created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(),
        }],
      }));
    });
    try {
      const { SupportActionsPanel } = await import('./SupportActionsPanel');
      render(<SupportActionsPanel />);

      const waiting = await screen.findByRole('list', { name: "Waiting for a member's yes" });
      expect(waiting).toHaveTextContent('Molly Member');
      expect(waiting).toHaveTextContent('Set up by');
      expect(screen.getByRole('button', { name: /Record the member's yes/ })).toBeInTheDocument();

      const proof = screen.getByRole('list', { name: 'Proof that a supporter may act alone' });
      expect(proof).toHaveTextContent('Not noted yet');
      expect(screen.getByRole('button', { name: 'Note that I have seen it' })).toBeInTheDocument();
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    } finally {
      matchMedia.mockRestore();
    }
  });
});
