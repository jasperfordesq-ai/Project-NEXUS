// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import Users from 'lucide-react/icons/users';
import i18n from '@/i18n';

vi.mock('@/contexts', () => createMockContexts());

// The broker tile has its own tests; here only the hand-over matters.
vi.mock('@/broker/components/BrokerStatCard', () => ({
  BrokerStatCard: (props: Record<string, unknown>) => (
    <div
      data-testid="broker-stat-card"
      data-color={String(props.color)}
      data-to={props.to === undefined ? undefined : String(props.to)}
      data-link-aria-label={props.linkAriaLabel === undefined ? undefined : String(props.linkAriaLabel)}
      data-loading={String(props.loading)}
      data-delta={props.delta === undefined ? undefined : String(props.delta)}
      data-delta-label={props.deltaLabel === undefined ? undefined : String(props.deltaLabel)}
    >
      {String(props.label)}
    </div>
  ),
}));

import { StatCard } from './StatCard';

describe('StatCard', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the label', () => {
    render(<StatCard label="Total Members" value={42} icon={Users} />);
    expect(screen.getByText('Total Members')).toBeInTheDocument();
  });

  it('renders title when label is absent', () => {
    render(<StatCard title="Active Users" value={10} icon={Users} />);
    expect(screen.getByText('Active Users')).toBeInTheDocument();
  });

  it('renders a string value', () => {
    render(<StatCard label="Status" value="Online" icon={Users} />);
    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  it('renders a numeric value with locale formatting', () => {
    render(<StatCard label="Credits" value={1000} icon={Users} />);
    expect(screen.getByText(new Intl.NumberFormat('en').format(1000))).toBeInTheDocument();
  });

  it('uses the selected application language instead of the browser locale', async () => {
    await i18n.changeLanguage('de');
    render(<StatCard label="Credits" value={1234567.89} icon={Users} />);

    expect(
      screen.getByText(new Intl.NumberFormat('de').format(1234567.89)),
    ).toBeInTheDocument();
  });

  it('shows loading skeleton when loading=true', () => {
    render(<StatCard label="Members" value={0} icon={Users} loading />);
    const loadingEl = getAllByAriabusy(true);
    expect(loadingEl.length).toBeGreaterThan(0);
  });

  it('does not show loading skeleton when loading=false', () => {
    render(<StatCard label="Members" value={5} icon={Users} loading={false} />);
    expect(getAriabusy(true)).toBeUndefined();
  });

  it('renders description when provided', () => {
    render(<StatCard label="X" value={1} icon={Users} description="since last month" />);
    expect(screen.getByText('since last month')).toBeInTheDocument();
  });

  it('renders positive trend indicator', () => {
    render(<StatCard label="X" value={1} icon={Users} trend={12} trendLabel="vs last week" />);
    expect(screen.getByText('+12%')).toBeInTheDocument();
    expect(screen.getByText('vs last week')).toBeInTheDocument();
  });

  it('renders negative trend indicator', () => {
    render(<StatCard label="X" value={1} icon={Users} trend={-5} />);
    expect(screen.getByText('-5%')).toBeInTheDocument();
  });

  it('renders zero trend without a + prefix', () => {
    render(<StatCard label="X" value={1} icon={Users} trend={0} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('renders as a link when "to" is provided', () => {
    render(<StatCard label="Members" value={3} icon={Users} to="/admin/members" />);
    // HeroUI Card isPressable as Link renders with role="link"
    const link = screen.getByRole('link');
    expect(link).toBeInTheDocument();
  });

  it('does not render a link when "to" is absent', () => {
    render(<StatCard label="Members" value={3} icon={Users} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('uses linkAriaLabel when provided as the link label', () => {
    render(
      <StatCard
        label="Members"
        value={3}
        icon={Users}
        to="/admin/members"
        linkAriaLabel="View all members"
      />
    );
    expect(screen.getByRole('link', { name: 'View all members' })).toBeInTheDocument();
  });

  it('renders pre-built JSX icon without double-wrapping', () => {
    const IconEl = <span data-testid="jsx-icon" />;
    render(<StatCard label="X" value={1} icon={IconEl} />);
    expect(screen.getByTestId('jsx-icon')).toBeInTheDocument();
  });
});

/** Helpers */
function getAllByAriabusy(busy: boolean) {
  return Array.from(document.querySelectorAll('[aria-busy]')).filter(
    (el) => el.getAttribute('aria-busy') === String(busy)
  );
}

function getAriabusy(busy: boolean) {
  return getAllByAriabusy(busy)[0];
}

describe('StatCard inside AdminEmbed (broker panel)', () => {
  it('renders the broker stat card with the admin colours mapped onto the broker palette', async () => {
    const { AdminEmbed } = await import('./AdminEmbedContext');
    render(
      <AdminEmbed>
        <StatCard label="Pending Review" value={3} icon={Users} color="primary" to="/x" linkAriaLabel="Open pending" />
        <StatCard label="Rejected" value={4} icon={Users} color="secondary" />
        <StatCard label="Auto flagged" value={5} icon={Users} color="default" />
        <StatCard label="Flagged" value={6} icon={Users} color="danger" trend={12} trendLabel="vs last week" />
      </AdminEmbed>,
    );
    const cards = screen.getAllByTestId('broker-stat-card');
    expect(cards).toHaveLength(4);
    expect(cards[0]).toHaveAttribute('data-color', 'accent');
    expect(cards[0]).toHaveAttribute('data-to', '/x');
    expect(cards[0]).toHaveAttribute('data-link-aria-label', 'Open pending');
    expect(cards[0]).toHaveTextContent('Pending Review');
    expect(cards[1]).toHaveAttribute('data-color', 'neutral');
    expect(cards[2]).toHaveAttribute('data-color', 'neutral');
    expect(cards[3]).toHaveAttribute('data-color', 'danger');
    // The admin "trend" is a percentage delta, so it lands on the broker card's delta.
    expect(cards[3]).toHaveAttribute('data-delta', '12');
    expect(cards[3]).toHaveAttribute('data-delta-label', 'vs last week');
  });

  it('passes loading and the title fallback through', async () => {
    const { AdminEmbed } = await import('./AdminEmbedContext');
    render(
      <AdminEmbed>
        <StatCard title="Members" value={0} icon={Users} loading />
      </AdminEmbed>,
    );
    const card = screen.getByTestId('broker-stat-card');
    expect(card).toHaveAttribute('data-loading', 'true');
    expect(card).toHaveTextContent('Members');
  });

  it('does not use the broker card outside the embed', () => {
    render(<StatCard label="Members" value={3} icon={Users} />);
    expect(screen.queryByTestId('broker-stat-card')).not.toBeInTheDocument();
    expect(screen.getByText('Members')).toBeInTheDocument();
  });
});
