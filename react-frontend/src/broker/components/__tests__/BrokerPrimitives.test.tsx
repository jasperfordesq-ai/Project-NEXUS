// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Smoke + contract tests for the broker shared primitives.
 * useCountUp renders final values instantly in test mode, so numeric
 * assertions are deterministic.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Users from 'lucide-react/icons/users';
import Inbox from 'lucide-react/icons/inbox';

import { BrokerStatCard } from '../BrokerStatCard';
import { BrokerPageShell } from '../BrokerPageShell';
import { BrokerEmptyState } from '../BrokerEmptyState';
import { BrokerSkeleton } from '../BrokerSkeleton';
import { BrokerStatusChip, brokerStatusColor } from '../BrokerStatusChip';
import { BrokerSparkline } from '../BrokerSparkline';

function wrap(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('BrokerStatCard', () => {
  it('renders label and formatted numeric value', () => {
    wrap(<BrokerStatCard label="Pending members" value={1234} icon={Users} />);
    expect(screen.getByText('Pending members')).toBeInTheDocument();
    expect(screen.getByText((1234).toLocaleString())).toBeInTheDocument();
  });

  it('renders a dash for null values', () => {
    wrap(<BrokerStatCard label="Broken metric" value={null} icon={Users} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('becomes a link when `to` is provided', () => {
    wrap(<BrokerStatCard label="Queue" value={3} icon={Users} to="/t/broker/members" />);
    const link = screen.getByRole('link', { name: 'Queue' });
    expect(link).toHaveAttribute('href', '/t/broker/members');
  });

  it('shows a skeleton while loading', () => {
    wrap(<BrokerStatCard label="Queue" value={3} icon={Users} loading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('3')).not.toBeInTheDocument();
  });

  it('renders a positive delta with sign', () => {
    wrap(<BrokerStatCard label="Members" value={10} icon={Users} delta={12} deltaLabel="vs last month" />);
    expect(screen.getByText('+12%')).toBeInTheDocument();
    expect(screen.getByText('vs last month')).toBeInTheDocument();
  });
});

describe('BrokerPageShell', () => {
  it('renders title as an h1, description, actions, toolbar and children', () => {
    wrap(
      <BrokerPageShell
        title="Members"
        description="Manage community members"
        icon={Users}
        actions={<button type="button">Refresh</button>}
        toolbar={<input aria-label="Search members" />}
      >
        <p>Page body</p>
      </BrokerPageShell>
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Members' })).toBeInTheDocument();
    expect(screen.getByText('Manage community members')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search members')).toBeInTheDocument();
    expect(screen.getByText('Page body')).toBeInTheDocument();
  });
});

describe('BrokerEmptyState', () => {
  it('renders title, hint and action', () => {
    wrap(
      <BrokerEmptyState
        icon={Inbox}
        title="All caught up"
        hint="No messages are waiting for review."
        action={<button type="button">Go to dashboard</button>}
      />
    );
    expect(screen.getByText('All caught up')).toBeInTheDocument();
    expect(screen.getByText('No messages are waiting for review.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to dashboard' })).toBeInTheDocument();
  });
});

describe('BrokerSkeleton', () => {
  it.each(['stats', 'table', 'cards', 'detail'] as const)('renders %s variant as a busy status region', (variant) => {
    wrap(<BrokerSkeleton variant={variant} />);
    const region = screen.getAllByRole('status')[0];
    expect(region).toHaveAttribute('aria-busy', 'true');
  });
});

describe('BrokerStatusChip', () => {
  it('renders a translated label for known statuses', () => {
    wrap(<BrokerStatusChip status="pending_broker" />);
    expect(screen.getByText('Pending Broker Approval')).toBeInTheDocument();
  });

  // BrokerStatusChip deliberately does NOT prettify an unrecognised status into
  // "Weird New State" — its own docblock says unknown statuses get "a localized
  // generic label on a neutral chip rather than leaking a raw snake_case key",
  // i.e. t('status.unknown'). This test asserted the prettified form the
  // component was changed away from, so it could never pass. What matters —
  // and what is asserted now — is that the raw key never reaches the screen.
  it('shows a generic label for unknown statuses instead of leaking raw keys', () => {
    wrap(<BrokerStatusChip status="weird_new_state" />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('weird_new_state')).not.toBeInTheDocument();
    expect(screen.queryByText('Weird New State')).not.toBeInTheDocument();
  });

  it('maps semantics consistently', () => {
    expect(brokerStatusColor('approved')).toBe('success');
    expect(brokerStatusColor('pending')).toBe('warning');
    expect(brokerStatusColor('rejected')).toBe('danger');
    expect(brokerStatusColor('critical')).toBe('danger');
    expect(brokerStatusColor('unknown_thing')).toBe('default');
  });
});

describe('BrokerSparkline', () => {
  it('renders nothing with fewer than 2 points', () => {
    const { container } = wrap(<BrokerSparkline points={[5]} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders an aria-hidden svg for a series', () => {
    const { container } = wrap(<BrokerSparkline points={[1, 4, 2, 8]} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
});
