// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import Activity from 'lucide-react/icons/activity';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/contexts', () => createMockContexts());

import { BrokerSectionCard } from './BrokerSectionCard';

describe('BrokerSectionCard', () => {
  it('renders the title, the count and the body', () => {
    render(
      <BrokerSectionCard title="Recent Activity" icon={Activity} count={7}>
        <p>Panel body</p>
      </BrokerSectionCard>,
    );
    expect(screen.getByRole('heading', { level: 2, name: /Recent Activity/ })).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('Panel body')).toBeInTheDocument();
  });

  it('shows "View all" as a link when given a destination', () => {
    render(
      <BrokerSectionCard title="Messages" icon={Activity} viewAllTo="/test/broker/messages">
        <p>Body</p>
      </BrokerSectionCard>,
    );
    expect(screen.getByRole('link', { name: 'View All' })).toHaveAttribute('href', '/test/broker/messages');
  });

  it('shows "View all" as a button when given an action, and calls it', async () => {
    const onViewAll = vi.fn();
    render(
      <BrokerSectionCard title="Messages" icon={Activity} onViewAll={onViewAll} viewAllLabel="See all">
        <p>Body</p>
      </BrokerSectionCard>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'See all' }));
    expect(onViewAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows no corner action when neither is given', () => {
    render(
      <BrokerSectionCard title="Quiet" icon={Activity}>
        <p>Body</p>
      </BrokerSectionCard>,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
