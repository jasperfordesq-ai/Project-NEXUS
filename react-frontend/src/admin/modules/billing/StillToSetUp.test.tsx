// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@/test/test-utils';
import type { SetupItem } from './StillToSetUp';

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

const onAssignPlan = vi.fn();
const onSetDate = vi.fn();

const item = (id: number, overrides: Partial<SetupItem> = {}): SetupItem => ({
  id,
  name: `Community ${id}`,
  noPlan: true,
  noDate: true,
  ...overrides,
});

const renderList = async (items: SetupItem[], isDisabled = false) => {
  const { StillToSetUp } = await import('./StillToSetUp');
  return render(
    <StillToSetUp items={items} onAssignPlan={onAssignPlan} onSetDate={onSetDate} isDisabled={isDisabled} />,
  );
};

describe('StillToSetUp', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders nothing when there is nothing to set up', async () => {
    await renderList([]);

    expect(screen.queryByTestId('still-to-set-up')).not.toBeInTheDocument();
  });

  it('says what each community is missing', async () => {
    await renderList([
      item(1),
      item(2, { noDate: false }),
      item(3, { noPlan: false }),
    ]);

    expect(screen.getByText('Still to set up (3)')).toBeInTheDocument();
    expect(within(screen.getByTestId('setup-item-1')).getByText('No plan and no paid-until date')).toBeInTheDocument();
    expect(within(screen.getByTestId('setup-item-2')).getByText('No plan')).toBeInTheDocument();
    expect(within(screen.getByTestId('setup-item-3')).getByText('No paid-until date')).toBeInTheDocument();
  });

  it('offers the plan first, and the date when only the date is missing', async () => {
    await renderList([item(1), item(3, { noPlan: false })]);

    fireEvent.click(screen.getByRole('button', { name: 'Assign plan: Community 1' }));
    expect(onAssignPlan).toHaveBeenCalledWith(1);
    expect(onSetDate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Set paid-until date: Community 3' }));
    expect(onSetDate).toHaveBeenCalledWith(3);
  });

  it('offers the date where the plan is not this person\'s to give, and no button when nothing can be done', async () => {
    await renderList([
      item(1, { canAssignPlan: false }),
      item(2, { canAssignPlan: false, noDate: false }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Set paid-until date: Community 1' }));
    expect(onSetDate).toHaveBeenCalledWith(1);
    // Still listed, so it is not forgotten, but with nothing to press.
    expect(within(screen.getByTestId('setup-item-2')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('lists five at first and the rest when asked', async () => {
    await renderList([1, 2, 3, 4, 5, 6, 7].map((id) => item(id)));

    expect(screen.getByText('Still to set up (7)')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);

    fireEvent.click(screen.getByRole('button', { name: 'Show all 7' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(7);

    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });

  it('does not offer "Show all" when everything is already listed', async () => {
    await renderList([1, 2, 3, 4, 5].map((id) => item(id)));

    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.queryByRole('button', { name: /^Show all/ })).not.toBeInTheDocument();
  });
});
