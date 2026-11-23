// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { formatDate } from '@/lib/helpers';

// The shared Proxy mock, with Select as a native <select> so a choice can be made.
vi.mock('@/components/ui', async () => {
  const base = (await import('@/test/uiMock')).uiMock as Record<string, unknown>;
  const overrides: Record<string, unknown> = {
    Select: ({ children, label, selectedKeys, onSelectionChange, description }: {
      children?: React.ReactNode; label?: string; description?: React.ReactNode;
      selectedKeys?: Iterable<string>; onSelectionChange?: (keys: Set<string>) => void;
    }) => {
      const keys = selectedKeys ? Array.from(selectedKeys) : [];
      return (
        <div>
          <select aria-label={label} value={keys[0] ?? ''} onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}>
            {children}
          </select>
          {description ? <p>{description}</p> : null}
        </div>
      );
    },
    SelectItem: ({ children, id }: { children?: React.ReactNode; id?: string }) => <option value={id}>{children}</option>,
  };
  return new Proxy(base, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in overrides) return overrides[prop];
      return Reflect.get(target, prop);
    },
    has(target, prop) {
      if (typeof prop === 'string' && prop in overrides) return true;
      return prop in (target as Record<string, unknown>);
    },
  });
});

import { OverLimitRuleDialog, OverLimitSummary, type OverLimitState } from './OverLimitRuleDialog';

// The over_limit object the server sends (OverLimitRule::for() + own values + acts_on).
const makeState = (overrides: Record<string, unknown> = {}) => ({
  action: 'pause',
  effective_action: 'pause',
  grace_days: 30,
  action_source: 'platform',
  days_source: 'platform',
  own_action: null,
  own_grace_days: null,
  acts_on: null,
  ...overrides,
}) as OverLimitState;

const select = () => screen.getByLabelText('What happens') as HTMLSelectElement;
const optionLabels = () => Array.from(select().options).map((o) => o.textContent);

describe('OverLimitSummary', () => {
  it('shows the rule, the days and where a default comes from', () => {
    render(<OverLimitSummary rule={makeState({ action_source: 'hub' })} />);

    expect(screen.getByText('Pause after 30 days')).toBeInTheDocument();
    expect(screen.getByText("parent community's default")).toBeInTheDocument();
  });

  it('says one day, not one days', () => {
    const { unmount } = render(<OverLimitSummary rule={makeState({ grace_days: 1 })} />);
    expect(screen.getByText('Pause after 1 day')).toBeInTheDocument();
    unmount();

    render(<OverLimitSummary rule={makeState({ action: 'upgrade', effective_action: 'upgrade', grace_days: 1 })} />);
    expect(screen.getByText('Move up after 1 day')).toBeInTheDocument();
  });

  it('says nothing about a source when the community set the rule itself', () => {
    render(<OverLimitSummary rule={makeState({ action: 'block_joining', effective_action: 'block_joining', action_source: 'community' })} />);

    expect(screen.getByText('Stop joining')).toBeInTheDocument();
    expect(screen.queryByText("parent community's default")).not.toBeInTheDocument();
    expect(screen.queryByText('platform default')).not.toBeInTheDocument();
  });

  it('names the pause date when one is set', () => {
    render(<OverLimitSummary rule={makeState({ acts_on: '2026-12-21' })} />);

    const line = screen.getByText(`Pause on ${formatDate('2026-12-21')}`);
    expect(line.className).toContain('text-warning');
  });

  it('says the platform team moves a card payer up by hand', () => {
    render(<OverLimitSummary rule={makeState({ action: 'upgrade', effective_action: 'none' })} />);

    expect(screen.getByText('Move up (platform team does this one by hand)')).toBeInTheDocument();
  });

  it('shows a dash when there is no rule', () => {
    render(<OverLimitSummary rule={null} />);

    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('OverLimitRuleDialog', () => {
  const target = (overrides: Record<string, unknown> = {}, state: Record<string, unknown> = {}) => ({
    id: 7,
    name: 'Bandon Timebank',
    state: makeState(state),
    upgradeAllowed: true,
    ...overrides,
  });

  it('offers the default, naming it, and the four choices', () => {
    render(<OverLimitRuleDialog target={target()} onClose={vi.fn()} onSave={vi.fn()} />);

    expect(optionLabels()).toEqual([
      // The default here is the platform's, and the dialog says whose it is.
      'Follow the platform default (currently: Pause the community)',
      'Warn only',
      'Stop new members joining',
      'Pause the community',
      'Move up to the next plan',
    ]);
    expect(select().value).toBe('default');
    // The inherited rule is a pause, so the days field shows the default as a hint.
    expect((screen.getByLabelText('After how many days over') as HTMLInputElement).placeholder).toBe('30');
  });

  it('names a one-day default in the singular', () => {
    render(<OverLimitRuleDialog target={target({}, { grace_days: 1 })} onClose={vi.fn()} onSave={vi.fn()} />);

    expect(screen.getByText('Leave it empty to follow the default of 1 day.')).toBeInTheDocument();
  });

  it('names a longer default in the plural', () => {
    render(<OverLimitRuleDialog target={target()} onClose={vi.fn()} onSave={vi.fn()} />);

    expect(screen.getByText('Leave it empty to follow the default of 30 days.')).toBeInTheDocument();
  });

  it('leaves out moving up when it cannot be chosen', () => {
    render(<OverLimitRuleDialog target={target({ upgradeAllowed: false })} onClose={vi.fn()} onSave={vi.fn()} />);

    expect(optionLabels()).not.toContain('Move up to the next plan');
  });

  it('opens on the community’s own rule and days', () => {
    render(<OverLimitRuleDialog target={target({}, { own_action: 'upgrade', own_grace_days: 14, action: 'upgrade', action_source: 'community' })} onClose={vi.fn()} onSave={vi.fn()} />);

    expect(select().value).toBe('upgrade');
    expect((screen.getByLabelText('After how many days over') as HTMLInputElement).value).toBe('14');
    expect(screen.getByText(/moved to the smallest plan that fits/)).toBeInTheDocument();
  });

  it('hides the days for warn only and stop joining, and explains the choice', () => {
    render(<OverLimitRuleDialog target={target()} onClose={vi.fn()} onSave={vi.fn()} />);

    fireEvent.change(select(), { target: { value: 'block_joining' } });
    expect(screen.queryByLabelText('After how many days over')).not.toBeInTheDocument();
    expect(screen.getByText(/Nobody new can join/)).toBeInTheDocument();

    fireEvent.change(select(), { target: { value: 'none' } });
    expect(screen.queryByLabelText('After how many days over')).not.toBeInTheDocument();
  });

  it('sends the choice and the days, and null for following the default', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(true);
    render(<OverLimitRuleDialog target={target()} onClose={vi.fn()} onSave={onSave} />);

    fireEvent.change(select(), { target: { value: 'pause' } });
    fireEvent.change(screen.getByLabelText('After how many days over'), { target: { value: '45' } });
    await user.click(screen.getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ action: 'pause', grace_days: 45 }));

    onSave.mockClear();
    fireEvent.change(select(), { target: { value: 'default' } });
    fireEvent.change(screen.getByLabelText('After how many days over'), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ action: null, grace_days: null }));
  });

  it('refuses days that are not a whole number from 1 to 365', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(true);
    render(<OverLimitRuleDialog target={target()} onClose={vi.fn()} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('After how many days over'), { target: { value: '400' } });
    await user.click(screen.getByRole('button', { name: 'Save rule' }));

    expect(screen.getByText('Enter a whole number of days from 1 to 365.')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('renders nothing without a community', () => {
    render(<OverLimitRuleDialog target={null} onClose={vi.fn()} onSave={vi.fn()} />);

    expect(screen.queryByLabelText('What happens')).not.toBeInTheDocument();
  });

  it('names a default of "move up" as warn only for a card payer, as the table does', () => {
    render(<OverLimitRuleDialog
      target={target({ upgradeAllowed: false }, { action: 'upgrade', effective_action: 'none', action_source: 'hub' })}
      onClose={vi.fn()}
      onSave={vi.fn()}
    />);

    expect(optionLabels()[0]).toBe('Follow the default (currently: Warn only — a move is done by the platform team)');
    expect(optionLabels()).not.toContain('Move up to the next plan');
    // The explanation under the select is warn only's, not a promise of a move.
    expect(screen.getByText('The community’s admins are warned by email. Nothing else happens.')).toBeInTheDocument();
  });

  it('says when the automatic checks are off, and nothing while they are on', () => {
    const note = 'The platform’s automatic checks are switched off, so nothing here acts until the platform team switches them on. You can still set the rule now.';
    const { unmount } = render(<OverLimitRuleDialog target={target({}, { automation_enabled: false })} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByText(note)).toBeInTheDocument();
    unmount();

    render(<OverLimitRuleDialog target={target({}, { automation_enabled: true })} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.queryByText(note)).not.toBeInTheDocument();
  });
});

describe('OverLimitSummary dates', () => {
  it('names the day of a pending move up', () => {
    render(<OverLimitSummary rule={makeState({ action: 'upgrade', effective_action: 'upgrade', acts_on: '2026-12-21' })} />);

    expect(screen.getByText((text) => text.startsWith('Move up on '))).toBeInTheDocument();
    expect(screen.queryByText((text) => text.startsWith('Pause on '))).not.toBeInTheDocument();
  });
});
