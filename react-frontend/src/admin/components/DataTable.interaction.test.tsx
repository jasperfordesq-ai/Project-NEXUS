// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The opt-in interaction props the broker lists use on the shared table:
 * a clickable row (`onRowClick`), a search box the page controls
 * (`searchValue`) and server-side sorting (`sortDescriptor` + `onSortChange`).
 *
 * These render the REAL HeroUI / React Aria table (as the layouts test does),
 * because the row-click contract — "an interactive child must not also fire
 * the row" — only means something against the real press handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@/test/test-utils';
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
}

const ROWS: Row[] = [
  { id: 1, name: 'Ada Member', status: 'Pending' },
  { id: 2, name: 'Bo Member', status: 'Active' },
];

const columns: Column<Row>[] = [
  { key: 'name', label: 'Member', sortable: true },
  { key: 'status', label: 'Status' },
  {
    key: 'actions',
    label: 'Actions',
    render: (r) => (
      <span>
        <button type="button">Approve {r.name}</button>
        <a href="#profile">Profile {r.name}</a>
      </span>
    ),
  },
];

/**
 * A real mouse press and release. React Aria ticks a row on mouse-DOWN, which
 * `fireEvent.pointerDown` does not reproduce (it reads as a screen-reader
 * click), so the tests that guard against a stray tick press for real.
 */
async function mouseDownOn(element: Element) {
  const user = userEvent.setup();
  await user.pointer({ keys: '[MouseLeft>]', target: element });
  await user.pointer({ keys: '[/MouseLeft]', target: element });
}

describe('DataTable row click', () => {
  beforeEach(() => {
    isPhone.value = false;
  });

  it('calls onRowClick with the row when a cell is clicked', async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={ROWS} onRowClick={onRowClick} searchable={false} />);

    await user.click(screen.getByText('Bo Member'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(ROWS[1]);
  });

  it('does not fire the row when a button or link inside the row is clicked', async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={ROWS} onRowClick={onRowClick} searchable={false} />);

    await user.click(screen.getByRole('button', { name: 'Approve Ada Member' }));
    await user.click(screen.getByRole('link', { name: 'Profile Ada Member' }));
    expect(onRowClick).not.toHaveBeenCalled();

    // …and a plain cell click afterwards still works (the guard resets).
    await user.click(screen.getByText('Ada Member'));
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
  });

  it('reaches the row from the keyboard: Enter on a focused row fires it', async () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} data={ROWS} onRowClick={onRowClick} searchable={false} />);

    const row = screen.getByText('Ada Member').closest('tr') as HTMLElement;
    expect(row).toBeTruthy();
    row.focus();
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyUp(row, { key: 'Enter' });
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
  });

  it('marks clickable rows with a pointer cursor, and leaves rows alone without onRowClick', () => {
    const { unmount } = render(<DataTable columns={columns} data={ROWS} onRowClick={() => undefined} searchable={false} />);
    expect(screen.getByText('Ada Member').closest('tr')?.className).toMatch(/cursor-pointer/);
    unmount();

    render(<DataTable columns={columns} data={ROWS} searchable={false} />);
    expect(screen.getByText('Ada Member').closest('tr')?.className ?? '').not.toMatch(/cursor-pointer/);
  });

  it('on a phone, a card is clickable too, keyboard-reachable, and ignores its own buttons', async () => {
    isPhone.value = true;
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={ROWS} mobileCards onRowClick={onRowClick} searchable={false} />);

    const cards = within(screen.getByTestId('data-table-cards')).getAllByRole('listitem');
    const first = cards[0] as HTMLElement;
    // The card body (not the list item itself) is the focusable button.
    const body = first.firstElementChild as HTMLElement;
    expect(body).toHaveAttribute('tabindex', '0');
    expect(body).toHaveAttribute('role', 'button');

    await user.click(within(first).getByRole('button', { name: 'Approve Ada Member' }));
    expect(onRowClick).not.toHaveBeenCalled();

    await user.click(within(first).getByText('Pending'));
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);

    body.focus();
    await user.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenCalledTimes(2);
    await user.keyboard(' ');
    expect(onRowClick).toHaveBeenCalledTimes(3);
  });
});

/**
 * A list that both opens its rows and ticks them for a bulk action. Until
 * November 2026 React Aria ran the ticking: a press anywhere in a row ticked
 * it on mouse-DOWN, the "1 selected" bar appeared above the list, the list
 * moved before the button came back up, and the click landed on nothing — so
 * opening a message took three or four clicks, each one ticking or unticking
 * the row instead. Now the row opens and only its box ticks.
 */
describe('DataTable that opens rows and ticks them (selectable + onRowClick)', () => {
  beforeEach(() => {
    isPhone.value = false;
  });

  function setup(selected: Set<string> = new Set()) {
    const onRowClick = vi.fn();
    const onSelectionChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={ROWS}
        selectable
        selectedKeys={selected}
        onSelectionChange={onSelectionChange}
        onRowClick={onRowClick}
        searchable={false}
      />,
    );
    return { onRowClick, onSelectionChange };
  }

  it('opens the row on a cell click and ticks nothing', async () => {
    const { onRowClick, onSelectionChange } = setup();
    await userEvent.setup().click(screen.getByText('Bo Member'));
    expect(onRowClick).toHaveBeenCalledWith(ROWS[1]);
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('still opens the row while another row is ticked', async () => {
    const { onRowClick, onSelectionChange } = setup(new Set(['1']));
    await userEvent.setup().click(screen.getByText('Bo Member'));
    expect(onRowClick).toHaveBeenCalledWith(ROWS[1]);
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('ticks nothing when the mouse goes down on a link or a button in the row', async () => {
    const { onSelectionChange } = setup();
    await mouseDownOn(screen.getByRole('link', { name: 'Profile Ada Member' }));
    await mouseDownOn(screen.getByRole('button', { name: 'Approve Ada Member' }));
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('ticks a row from its own box without opening it', async () => {
    const { onRowClick, onSelectionChange } = setup();
    await userEvent.setup().click(screen.getByRole('checkbox', { name: /select row 2/i }));
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect([...(onSelectionChange.mock.calls[0]?.[0] as Set<string>)]).toEqual(['2']);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('shows which rows are ticked and unticks one from its box', async () => {
    const { onSelectionChange } = setup(new Set(['1', '2']));
    const first = screen.getByRole('checkbox', { name: /select row 1/i });
    expect(first).toBeChecked();
    await userEvent.setup().click(first);
    expect([...(onSelectionChange.mock.calls[0]?.[0] as Set<string>)]).toEqual(['2']);
  });

  it('ticks every row on the page from the heading box, and unticks them again', async () => {
    const user = userEvent.setup();
    const { onSelectionChange } = setup();
    await user.click(screen.getByRole('checkbox', { name: /select all rows/i }));
    expect([...(onSelectionChange.mock.calls[0]?.[0] as Set<string>)].sort()).toEqual(['1', '2']);
  });

  it('unticks every row from the heading box once they are all ticked', async () => {
    const { onSelectionChange } = setup(new Set(['1', '2']));
    const all = screen.getByRole('checkbox', { name: /select all rows/i });
    expect(all).toBeChecked();
    await userEvent.setup().click(all);
    expect([...(onSelectionChange.mock.calls[0]?.[0] as Set<string>)]).toEqual([]);
  });
});

/**
 * A list that only ticks (no row click). A press on the row still ticks it —
 * that is React Aria's convention and the admin lists rely on it — but a press
 * that starts on a link or button the row contains belongs to that control.
 */
describe('DataTable that only ticks rows (selectable, no onRowClick)', () => {
  beforeEach(() => {
    isPhone.value = false;
  });

  it('does not tick the row when the mouse goes down on a link or button inside it', async () => {
    const onSelectionChange = vi.fn();
    render(
      <DataTable columns={columns} data={ROWS} selectable selectedKeys={new Set()} onSelectionChange={onSelectionChange} searchable={false} />,
    );
    await mouseDownOn(screen.getByRole('link', { name: 'Profile Ada Member' }));
    await mouseDownOn(screen.getByRole('button', { name: 'Approve Ada Member' }));
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('still ticks the row when a plain cell is pressed', async () => {
    const onSelectionChange = vi.fn();
    render(
      <DataTable columns={columns} data={ROWS} selectable selectedKeys={new Set()} onSelectionChange={onSelectionChange} searchable={false} />,
    );
    await userEvent.setup().click(screen.getByText('Bo Member'));
    expect(onSelectionChange).toHaveBeenCalled();
    expect([...(onSelectionChange.mock.calls[0]?.[0] as Set<string>)]).toEqual(['2']);
  });
});

describe('DataTable controlled search', () => {
  it('shows the value the page passes and follows it when it changes', () => {
    const { rerender } = render(
      <DataTable columns={columns} data={ROWS} searchValue="ada" onSearch={() => undefined} />,
    );
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    expect(input.value).toBe('ada');

    rerender(<DataTable columns={columns} data={ROWS} searchValue="bo" onSearch={() => undefined} />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('bo');
  });

  it('still reports typing through onSearch while controlled', () => {
    const onSearch = vi.fn();
    render(<DataTable columns={columns} data={ROWS} searchValue="" onSearch={onSearch} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Bo' } });
    expect(onSearch).toHaveBeenCalledWith('Bo');
  });
});

describe('DataTable server-side sorting', () => {
  it('reports a header click as (key, direction) and does not reorder the page itself', async () => {
    const onSortChange = vi.fn();
    const user = userEvent.setup();
    const unsorted: Row[] = [ROWS[1] as Row, ROWS[0] as Row]; // Bo before Ada
    render(
      <DataTable
        columns={columns}
        data={unsorted}
        onSortChange={onSortChange}
        sortDescriptor={{ column: 'status', direction: 'asc' }}
        searchable={false}
      />,
    );

    await user.click(screen.getByText('Member'));
    expect(onSortChange).toHaveBeenCalledWith('name', 'asc');

    // Server sorting: the rows stay exactly as the page passed them.
    const cells = screen.getAllByRole('rowheader').map((c) => c.textContent);
    expect(cells).toEqual(['Bo Member', 'Ada Member']);
  });

  it('flips to descending when the sorted column is clicked again', async () => {
    const onSortChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTable
        columns={columns}
        data={ROWS}
        onSortChange={onSortChange}
        sortDescriptor={{ column: 'name', direction: 'asc' }}
        searchable={false}
      />,
    );
    await user.click(screen.getByText('Member'));
    expect(onSortChange).toHaveBeenCalledWith('name', 'desc');
  });

  it('without onSortChange keeps sorting the visible page locally (admin panel behaviour)', async () => {
    const user = userEvent.setup();
    const unsorted: Row[] = [ROWS[1] as Row, ROWS[0] as Row];
    render(<DataTable columns={columns} data={unsorted} searchable={false} />);

    await user.click(screen.getByText('Member'));
    const cells = screen.getAllByRole('rowheader').map((c) => c.textContent);
    expect(cells).toEqual(['Ada Member', 'Bo Member']);
  });
});
