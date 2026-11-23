// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

vi.mock('@/contexts', () => createMockContexts());

// The AdminHelpDrawer is a complex portal component; stub it so the test stays focused.
vi.mock('./AdminHelpDrawer', () => ({
  AdminHelpDrawer: ({ isOpen, article }: { isOpen: boolean; article: { title: string } }) =>
    isOpen ? <div data-testid="help-drawer">{article.title}</div> : null,
}));

// Stub helpContent so we control when a help article exists.
vi.mock('../data/helpContent', () => ({
  getHelpContent: () => ({
    '/admin/dashboard': {
      title: 'Dashboard Help',
      summary: 'Help for dashboard',
    },
    '/platform-team/billing': {
      title: 'Billing control Help',
      summary: 'Help for Billing control',
    },
    '/super-admin/branch-payments': {
      title: 'Branch payments Help',
      summary: 'Help for Branch payments',
    },
  }),
}));

import { PageHeader } from './PageHeader';
import { AdminEmbed } from './AdminEmbedContext';

describe('PageHeader', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('renders the page title', () => {
    render(<PageHeader title="My Page" />);
    expect(screen.getByRole('heading', { name: 'My Page' })).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<PageHeader title="Settings" description="Configure your settings here." />);
    expect(screen.getByText('Configure your settings here.')).toBeInTheDocument();
  });

  it('renders subtitle when description is absent', () => {
    render(<PageHeader title="Events" subtitle="Manage events for your community." />);
    expect(screen.getByText('Manage events for your community.')).toBeInTheDocument();
  });

  it('prefers description over subtitle', () => {
    render(<PageHeader title="X" description="Desc text" subtitle="Sub text" />);
    expect(screen.getByText('Desc text')).toBeInTheDocument();
    expect(screen.queryByText('Sub text')).not.toBeInTheDocument();
  });

  it('renders icon when provided', () => {
    render(<PageHeader title="Stats" icon={<span data-testid="test-icon" />} />);
    expect(screen.getByTestId('test-icon')).toBeInTheDocument();
  });

  it('renders actions slot when provided', () => {
    render(<PageHeader title="Members" actions={<button>Export</button>} />);
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('does NOT render a help button when the route has no help article', () => {
    render(<PageHeader title="No Help Page" />);
    expect(screen.queryByRole('button', { name: /help/i })).not.toBeInTheDocument();
  });

  it('loads the contextual help article after render and opens the drawer on demand', async () => {
    window.history.pushState({}, '', '/admin/dashboard');
    const user = userEvent.setup();

    render(<PageHeader title="Dashboard" />);

    expect(screen.queryByRole('button', { name: /open page help/i })).not.toBeInTheDocument();

    const helpButton = await screen.findByRole('button', { name: /open page help/i });
    await user.click(helpButton);

    await waitFor(() => {
      expect(screen.getByTestId('help-drawer')).toHaveTextContent('Dashboard Help');
    });
  });

  // The address carries the community's name on a shared host
  // ("/hour-timebank/platform-team/billing") and not on a community's own
  // domain. The Platform team panel was missing from the list of panels whose
  // address is trimmed, so none of its pages could show help on a shared host.
  it.each([
    ['a Platform team page, with the community in the address', '/hour-timebank/platform-team/billing', 'Billing control Help'],
    ['a Platform team page, without it', '/platform-team/billing', 'Billing control Help'],
    ['a super admin page, with the community in the address', '/hour-timebank/super-admin/branch-payments', 'Branch payments Help'],
    ['an admin page, with the community in the address', '/hour-timebank/admin/dashboard', 'Dashboard Help'],
  ])('finds the help for %s', async (_what, address, title) => {
    window.history.pushState({}, '', address);
    const user = userEvent.setup();

    render(<PageHeader title="A page" />);

    await user.click(await screen.findByRole('button', { name: /open page help/i }));
    await waitFor(() => expect(screen.getByTestId('help-drawer')).toHaveTextContent(title));
  });

  it('does not mistake a community whose name starts like a panel for that panel', async () => {
    // "/platform-team-fans/..." is a community's name, not the panel.
    window.history.pushState({}, '', '/admin-club/platform-team-notes');

    render(<PageHeader title="A page" />);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('button', { name: /open page help/i })).not.toBeInTheDocument();
  });

  describe('inside AdminEmbed (broker panel)', () => {
    it('renders only the actions, as a toolbar, when embedded', () => {
      render(
        <AdminEmbed>
          <PageHeader title="Safeguarding" description="Admin copy" actions={<button>Refresh</button>} />
        </AdminEmbed>,
      );
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Safeguarding' })).not.toBeInTheDocument();
      expect(screen.queryByText('Admin copy')).not.toBeInTheDocument();
    });

    it('renders nothing at all when embedded without actions', () => {
      const { container } = render(
        <AdminEmbed>
          <PageHeader title="Loading state" description="Admin copy" />
        </AdminEmbed>,
      );
      expect(container).toBeEmptyDOMElement();
    });

    // The broker page shell hands the embed an element inside its own page
    // header; the module's buttons belong there, not in a toolbar card of
    // their own in the content area.
    it('moves the actions into the host page header when the embed provides one', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      try {
        const { container } = render(
          <AdminEmbed actionsHost={host}>
            <PageHeader title="Safeguarding" description="Admin copy" actions={<button>Refresh</button>} />
          </AdminEmbed>,
        );
        const button = screen.getByRole('button', { name: 'Refresh' });
        expect(host.contains(button)).toBe(true);
        expect(container).toBeEmptyDOMElement();
      } finally {
        host.remove();
      }
    });

    it('renders nothing into the host when embedded without actions', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      try {
        render(
          <AdminEmbed actionsHost={host}>
            <PageHeader title="Safeguarding" description="Admin copy" />
          </AdminEmbed>,
        );
        expect(host).toBeEmptyDOMElement();
      } finally {
        host.remove();
      }
    });
  });
});
