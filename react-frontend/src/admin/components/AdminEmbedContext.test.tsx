// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';

const mockUseBrokerAutoRefresh = vi.hoisted(() => vi.fn());
vi.mock('@/broker/useBrokerAutoRefresh', () => ({
  useBrokerAutoRefresh: mockUseBrokerAutoRefresh,
}));

import {
  AdminEmbed,
  AdminEmbedActions,
  AdminEmbedAutoRefresh,
  useAdminEmbed,
  useAdminEmbedActionsHost,
  useAdminEmbedded,
} from './AdminEmbedContext';

function Probe() {
  const embed = useAdminEmbed();
  const embedded = useAdminEmbedded();
  return (
    <div
      data-testid="probe"
      data-embedded={String(embed.embedded)}
      data-legacy-embedded={String(embedded)}
      data-has-host={String(embed.actionsHost !== null)}
    />
  );
}

describe('AdminEmbedContext', () => {
  beforeEach(() => {
    mockUseBrokerAutoRefresh.mockReset();
  });

  it('is not embedded and has no actions host outside a provider', () => {
    render(<Probe />);
    const probe = screen.getByTestId('probe');
    expect(probe).toHaveAttribute('data-embedded', 'false');
    expect(probe).toHaveAttribute('data-legacy-embedded', 'false');
    expect(probe).toHaveAttribute('data-has-host', 'false');
  });

  it('reports embedded inside AdminEmbed, with the host the wrapper page supplied', () => {
    const host = document.createElement('div');
    render(
      <AdminEmbed actionsHost={host}>
        <Probe />
      </AdminEmbed>,
    );
    const probe = screen.getByTestId('probe');
    expect(probe).toHaveAttribute('data-embedded', 'true');
    expect(probe).toHaveAttribute('data-legacy-embedded', 'true');
    expect(probe).toHaveAttribute('data-has-host', 'true');
  });

  describe('AdminEmbedAutoRefresh', () => {
    it('does nothing in the admin panel', () => {
      render(<AdminEmbedAutoRefresh reload={() => undefined} />);
      expect(mockUseBrokerAutoRefresh).not.toHaveBeenCalled();
    });

    it('subscribes the reload to the broker auto-refresh when embedded', () => {
      const reload = vi.fn();
      render(
        <AdminEmbed>
          <AdminEmbedAutoRefresh reload={reload} />
        </AdminEmbed>,
      );
      expect(mockUseBrokerAutoRefresh).toHaveBeenCalledWith(reload);
    });
  });

  describe('useAdminEmbedActionsHost (the wrapper page side)', () => {
    function WrapperPage({ renders }: { renders: { count: number } }) {
      const { actionsHost, actionsSlot } = useAdminEmbedActionsHost();
      return (
        <div>
          <header data-testid="page-header">{actionsSlot}</header>
          <AdminEmbed actionsHost={actionsHost}>
            <Module renders={renders} />
          </AdminEmbed>
        </div>
      );
    }
    function Module({ renders }: { renders: { count: number } }) {
      renders.count += 1;
      return (
        <AdminEmbedActions fallback={<div data-testid="fallback" />}>
          <button type="button">Settings</button>
        </AdminEmbedActions>
      );
    }

    it('places the module actions inside the page header on the first render', () => {
      const renders = { count: 0 };
      render(<WrapperPage renders={renders} />);
      const header = screen.getByTestId('page-header');
      expect(header.contains(screen.getByRole('button', { name: 'Settings' }))).toBe(true);
      expect(screen.queryByTestId('fallback')).not.toBeInTheDocument();
      // No state update after mount, so the embedded module rendered once.
      expect(renders.count).toBe(1);
    });
  });

  describe('AdminEmbedActions', () => {
    it('renders the fallback in the admin panel', () => {
      render(
        <AdminEmbedActions fallback={<div data-testid="fallback">fallback</div>}>
          <button type="button">Refresh</button>
        </AdminEmbedActions>,
      );
      expect(screen.getByTestId('fallback')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    });

    it('renders the fallback when embedded without a host', () => {
      render(
        <AdminEmbed>
          <AdminEmbedActions fallback={<div data-testid="fallback">fallback</div>}>
            <button type="button">Refresh</button>
          </AdminEmbedActions>
        </AdminEmbed>,
      );
      expect(screen.getByTestId('fallback')).toBeInTheDocument();
    });

    it('moves the actions into the host element when embedded with one', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      try {
        render(
          <AdminEmbed actionsHost={host}>
            <AdminEmbedActions fallback={<div data-testid="fallback">fallback</div>}>
              <button type="button">Refresh</button>
            </AdminEmbedActions>
          </AdminEmbed>,
        );
        expect(screen.queryByTestId('fallback')).not.toBeInTheDocument();
        const button = screen.getByRole('button', { name: 'Refresh' });
        expect(host.contains(button)).toBe(true);
      } finally {
        host.remove();
      }
    });
  });
});
