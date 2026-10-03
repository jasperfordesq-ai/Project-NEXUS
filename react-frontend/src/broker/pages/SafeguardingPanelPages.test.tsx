// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The four safeguarding wrapper pages (support needs, guardians, support
 * actions, volunteering incidents): each frames its admin module in the
 * broker shell, inside the AdminEmbed provider, with its own browser-tab
 * title, one collapsed guide, and member names wired to the panel-wide
 * member window.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const { titles, openMember, panelProps } = vi.hoisted(() => ({
  titles: [] as string[],
  openMember: vi.fn(),
  panelProps: {} as Record<string, Record<string, unknown>>,
}));

vi.mock('@/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks')>();
  return {
    ...actual,
    usePageTitle: (title: string) => {
      titles.push(title);
    },
  };
});

vi.mock('@/broker/BrokerMemberWindow', () => ({
  useMemberWindow: () => ({ openId: null, open: openMember, close: vi.fn() }),
}));

// Each stand-in module reports whether it rendered inside the AdminEmbed
// provider and what props it was given.
function stub(name: string) {
  return async () => {
    const { useAdminEmbed, AdminEmbedActions } = await import('@/admin/components/AdminEmbedContext');
    const Stub = (props: Record<string, unknown>) => {
      panelProps[name] = props;
      const { embedded, actionsHost } = useAdminEmbed();
      return (
        <div data-testid={name} data-embedded={String(embedded)} data-has-host={String(actionsHost !== null)}>
          <AdminEmbedActions fallback={<span data-testid={`${name}-fallback`} />}>
            <button type="button">Refresh</button>
          </AdminEmbedActions>
        </div>
      );
    };
    return { [name]: Stub, default: Stub };
  };
}
vi.mock('@/admin/modules/safeguarding/MemberSupportNeedsPanel', stub('MemberSupportNeedsPanel'));
vi.mock('@/admin/modules/safeguarding/GuardiansPanel', stub('GuardiansPanel'));
vi.mock('@/admin/modules/safeguarding/SupportActionsPanel', stub('SupportActionsPanel'));
vi.mock('@/admin/modules/volunteering/VolunteerSafeguarding', stub('VolunteerSafeguarding'));
vi.mock('@/admin/modules/safeguarding/SafeguardingHelp', () => ({
  SafeguardingHelp: () => <div data-testid="safeguarding-help" />,
  default: () => <div data-testid="safeguarding-help" />,
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: (() => ({ user: { id: 1, role: 'broker' } })) as never,
  }),
);

beforeEach(() => {
  titles.length = 0;
  openMember.mockReset();
});

describe("SafeguardingSupportNeedsPage (Members' support needs)", () => {
  it('frames the panel in the broker shell, embedded, with names opening the member window', async () => {
    const Page = (await import('./SafeguardingSupportNeedsPage')).default;
    render(<Page />);

    expect(screen.getByRole('heading', { level: 1, name: "Members' support needs" })).toBeInTheDocument();
    expect(titles).toContain("Members' support needs");
    const panel = screen.getByTestId('MemberSupportNeedsPanel');
    expect(panel).toHaveAttribute('data-embedded', 'true');

    // The name handler is the panel-wide member window, not a modal of this page's own.
    (panelProps.MemberSupportNeedsPanel?.onOpenMember as (id: number) => void)(301);
    expect(openMember).toHaveBeenCalledWith(301);

    // One guide, collapsed, at the foot.
    expect(screen.getAllByTestId('safeguarding-help')).toHaveLength(1);
  });
});

describe('SafeguardingGuardiansPage', () => {
  it('frames the panel in the broker shell, embedded, with names opening the member window', async () => {
    const Page = (await import('./SafeguardingGuardiansPage')).default;
    render(<Page />);

    expect(screen.getByRole('heading', { level: 1, name: 'Guardians' })).toBeInTheDocument();
    expect(titles).toContain('Guardians');
    expect(screen.getByTestId('GuardiansPanel')).toHaveAttribute('data-embedded', 'true');
    (panelProps.GuardiansPanel?.onOpenMember as (id: number) => void)(202);
    expect(openMember).toHaveBeenCalledWith(202);
    expect(screen.getAllByTestId('safeguarding-help')).toHaveLength(1);
  });
});

describe('SafeguardingSupportActionsPage', () => {
  it("puts the panel's Refresh button in the page header, not in a card of its own", async () => {
    const Page = (await import('./SafeguardingSupportActionsPage')).default;
    render(<Page />);

    expect(screen.getByRole('heading', { level: 1, name: 'Support actions' })).toBeInTheDocument();
    expect(titles).toContain('Support actions');
    const panel = screen.getByTestId('SupportActionsPanel');
    expect(panel).toHaveAttribute('data-embedded', 'true');
    expect(panel).toHaveAttribute('data-has-host', 'true');

    const refresh = screen.getByRole('button', { name: 'Refresh' });
    // Rendered beside the h1, inside the header card — not inside the panel.
    expect(panel.contains(refresh)).toBe(false);
    expect(screen.getByRole('heading', { level: 1 }).closest('.mb-6')?.contains(refresh)).toBe(true);
    expect(screen.queryByTestId('SupportActionsPanel-fallback')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('safeguarding-help')).toHaveLength(1);
  });
});

describe('SafeguardingVolunteeringPage', () => {
  it("frames the module in the broker shell with its Refresh in the page header and the broker's own title", async () => {
    const Page = (await import('./SafeguardingVolunteeringPage')).default;
    render(<Page />);

    expect(screen.getByRole('heading', { level: 1, name: 'Volunteering incidents' })).toBeInTheDocument();
    expect(titles).toContain('Volunteering incidents');
    const panel = screen.getByTestId('VolunteerSafeguarding');
    expect(panel).toHaveAttribute('data-embedded', 'true');
    expect(panelProps.VolunteerSafeguarding?.canAssignDlp).toBe(false);
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    expect(panel.contains(refresh)).toBe(false);
    expect(screen.getByRole('heading', { level: 1 }).closest('.mb-6')?.contains(refresh)).toBe(true);
  });
});
