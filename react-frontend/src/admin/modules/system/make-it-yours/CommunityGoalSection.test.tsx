// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import type { AdminCommunityGoal } from '../../../api/adminApi';

const api = vi.hoisted(() => ({ updateGoal: vi.fn(), endGoal: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));

vi.mock('../../../api/adminApi', () => ({
  adminCommunitySetup: { updateGoal: api.updateGoal, endGoal: api.endGoal },
}));
vi.mock('@/contexts', () => createMockContexts({ useToast: () => toast }));

import { CommunityGoalSection, isValidGoalDates } from './CommunityGoalSection';

const TODAY = '2026-11-14';

function goal(overrides: Partial<AdminCommunityGoal> = {}): AdminCommunityGoal {
  return {
    id: 'b0a1c2d3e4f5',
    title: "Let's share 500 hours by spring",
    metric: 'hours',
    target: 500,
    starts_on: '2026-11-01',
    ends_on: '2027-03-31',
    current: 3.5,
    reached: false,
    finished: false,
    ...overrides,
  };
}

function renderSection(current: AdminCommunityGoal | null, onChanged = vi.fn(async () => undefined), onDirtyChange = vi.fn()) {
  render(
    <CommunityGoalSection goal={current} name="Riverside Timebank" today={TODAY} onChanged={onChanged} onDirtyChange={onDirtyChange} />,
  );
  return { section: screen.getByTestId('setup-goal'), onChanged, onDirtyChange };
}

describe('CommunityGoalSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.updateGoal.mockResolvedValue({ success: true, data: { community_goal: goal() } });
    api.endGoal.mockResolvedValue({ success: true, data: { community_goal: null } });
  });

  it('is an optional extra with an empty form when no goal is set', () => {
    const { section } = renderSection(null);

    expect(within(section).getByText('Optional')).toBeInTheDocument();
    expect(within(section).getByRole('heading', { name: 'A shared goal' })).toBeInTheDocument();
    expect(within(section).getByLabelText('Name of the goal')).toHaveValue('');
    expect(within(section).getByRole('radio', { name: 'Hours shared' })).toBeChecked();
    expect(within(section).getByLabelText('Starts on')).toHaveValue(TODAY);
    expect(within(section).getByRole('button', { name: 'Save goal' })).toBeDisabled();
    expect(within(section).queryByRole('button', { name: 'End goal' })).toBeNull();
    expect(section).not.toHaveTextContent(/\{\{/);
  });

  it('saves a new goal through its own endpoint and reads the page again', async () => {
    const { section, onChanged, onDirtyChange } = renderSection(null);

    fireEvent.change(within(section).getByLabelText('Name of the goal'), { target: { value: "  Let's run 10 events  " } });
    fireEvent.click(within(section).getByRole('radio', { name: 'Events held' }));
    fireEvent.change(within(section).getByLabelText('Target'), { target: { value: '10' } });
    fireEvent.change(within(section).getByLabelText('Ends on'), { target: { value: '2027-02-28' } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    const save = within(section).getByRole('button', { name: 'Save goal' });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(api.updateGoal).toHaveBeenCalledWith({
      title: "Let's run 10 events",
      metric: 'events',
      target: 10,
      starts_on: TODAY,
      ends_on: '2027-02-28',
    }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith('Goal saved. Members will see it on their dashboard.');
  });

  it('fills in the running goal and shows the progress so far', () => {
    const { section } = renderSection(goal());

    expect(within(section).getByLabelText('Name of the goal')).toHaveValue("Let's share 500 hours by spring");
    expect(within(section).getByLabelText('Target')).toHaveValue(500);
    expect(within(section).getByLabelText('Ends on')).toHaveValue('2027-03-31');
    expect(section).toHaveTextContent('So far: 3.5 of 500');
    expect(within(section).getByRole('progressbar')).toBeInTheDocument();
    // Nothing changed yet, so nothing to save.
    expect(within(section).getByRole('button', { name: 'Save goal' })).toBeDisabled();
  });

  it('says when the goal has been reached and when its end date has passed', () => {
    const { section } = renderSection(goal({ current: 512, reached: true }));
    expect(section).toHaveTextContent('Reached. Well done, everyone.');
  });

  it('asks for a new goal once the end date has passed', () => {
    const { section } = renderSection(goal({ ends_on: '2026-11-10', finished: true }));
    expect(section).toHaveTextContent('This goal’s end date has passed. Set a new goal, or end this one.');
  });

  it('ends the goal', async () => {
    const { section, onChanged } = renderSection(goal());
    fireEvent.click(within(section).getByRole('button', { name: 'End goal' }));

    await waitFor(() => expect(api.endGoal).toHaveBeenCalled());
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith('Goal ended. Members will see it under “What we’ve done together”.');
  });

  it('does not send a goal the server would refuse, and shows a refusal it does send', async () => {
    const { section } = renderSection(goal());
    const save = within(section).getByRole('button', { name: 'Save goal' });

    fireEvent.change(within(section).getByLabelText('Ends on'), { target: { value: '2026-10-01' } });
    expect(save).toBeDisabled();
    expect(section).toHaveTextContent('Check the goal:');

    fireEvent.change(within(section).getByLabelText('Ends on'), { target: { value: '2027-04-30' } });
    api.updateGoal.mockResolvedValueOnce({ success: false, error: 'Choose a whole number from 1 to 1,000,000.' });
    fireEvent.click(save);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Choose a whole number from 1 to 1,000,000.'));
  });

  it('checks dates the way the server does', () => {
    expect(isValidGoalDates('2026-11-01', '2027-03-31', TODAY)).toBe(true);
    expect(isValidGoalDates('2026-11-15', '2027-03-31', TODAY)).toBe(false); // starts after today
    expect(isValidGoalDates('2026-11-01', '2026-11-13', TODAY)).toBe(false); // already over
    expect(isValidGoalDates('2026-11-14', '2026-11-14', TODAY)).toBe(false); // must end after it starts
    expect(isValidGoalDates('2024-11-14', '2026-11-14', TODAY)).toBe(true);  // exactly two years (leap day)
    expect(isValidGoalDates('2024-11-13', '2026-11-15', TODAY)).toBe(false); // longer than two years
    expect(isValidGoalDates('2026-02-30', '2027-03-31', TODAY)).toBe(false); // no such day
  });
});
