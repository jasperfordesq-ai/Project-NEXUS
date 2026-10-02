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
  });
});
