// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The narrow-screen layouts the broker panel opts into: rows as cards on a
 * phone (`mobileCards`), a pinned actions column (`stickyActions`) and
 * columns that hide below a breakpoint (`hideBelow`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

const isPhone = vi.hoisted(() => ({ value: false }));
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => isPhone.value }));
vi.mock('@/contexts', () => createMockContexts());

import { DataTable, type Column } from './DataTable';

interface Row {
  id: number;
  name: string;
  status: string;
  requirement: string;
}

const ROWS: Row[] = [
  { id: 1, name: 'Ada Member', status: 'Pending', requirement: 'Same text on every row' },
  { id: 2, name: 'Bo Member', status: 'Active', requirement: 'Same text on every row' },
];

const columns: Column<Row>[] = [
  { key: 'name', label: 'Member' },
  { key: 'status', label: 'Status' },
  { key: 'requirement', label: 'Requirement', hideBelow: '2xl', hideInCard: true },
  { key: 'actions', label: 'Actions', render: (r) => <button type="button">Approve {r.name}</button> },
];

describe('DataTable narrow-screen layouts', () => {
  beforeEach(() => {
    isPhone.value = false;
  });

  it('renders cards on a phone, with the labels, the actions last and hide-in-card columns left out', () => {
    isPhone.value = true;
    render(<DataTable columns={columns} data={ROWS} mobileCards searchable={false} />);

    const cards = screen.getByTestId('data-table-cards');
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    const items = within(cards).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const first = items[0] as HTMLElement;
    expect(within(first).getByText('Ada Member')).toBeInTheDocument();
    expect(within(first).getByText('Status')).toBeInTheDocument();
    expect(within(first).getByText('Pending')).toBeInTheDocument();
    expect(within(first).getByRole('button', { name: 'Approve Ada Member' })).toBeInTheDocument();
    expect(within(first).queryByText('Same text on every row')).not.toBeInTheDocument();
  });

  it('keeps the table on a phone when the page has not opted in', () => {
    isPhone.value = true;
    render(<DataTable columns={columns} data={ROWS} searchable={false} />);
    expect(screen.queryByTestId('data-table-cards')).not.toBeInTheDocument();
  });

  it('lets a phone user select cards for a bulk action', async () => {
    isPhone.value = true;
    const onSelectionChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTable
        columns={columns}
        data={ROWS}
        mobileCards
        selectable
        selectedKeys={new Set(['2'])}
        onSelectionChange={onSelectionChange}
        searchable={false}
      />,
    );

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    await user.click(boxes[0] as HTMLElement);
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['2', '1']));
  });

  it('on a wide screen keeps the table, pins the actions column and marks hideBelow columns', () => {
    render(<DataTable columns={columns} data={ROWS} mobileCards stickyActions searchable={false} />);

    expect(screen.queryByTestId('data-table-cards')).not.toBeInTheDocument();
    const actionsCell = screen.getByRole('button', { name: 'Approve Ada Member' }).closest('td');
    expect(actionsCell?.className).toMatch(/sticky/);
    const requirementCell = screen.getAllByText('Same text on every row')[0]?.closest('td');
    expect(requirementCell?.className).toMatch(/hidden 2xl:table-cell/);
  });
});
