// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@/test/test-utils';
import { TableCell } from '@/components/ui';
import { ModerationCards } from './ModerationCards';

interface Row { id: number; who: string; text: string }
const ROWS: Row[] = [{ id: 1, who: 'Ann', text: 'Hello' }, { id: 2, who: 'Ben', text: 'Hi' }];

const renderCells = (r: Row) => [
  <TableCell key="user">{r.who}</TableCell>,
  <TableCell key="content">{r.text}</TableCell>,
  <TableCell key="actions"><button type="button">Hide {r.who}</button></TableCell>,
];

describe('ModerationCards', () => {
  it('lays each row out as a card: first cell as heading, labelled details, buttons last', () => {
    render(
      <ModerationCards
        ariaLabel="Posts"
        columns={[{ key: 'user', label: 'User' }, { key: 'content', label: 'Content' }, { key: 'actions', label: 'Actions' }]}
        items={ROWS}
        getKey={(r) => r.id}
        renderCells={renderCells}
      />,
    );
    const cards = within(screen.getByRole('list', { name: 'Posts' })).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    const first = cards[0] as HTMLElement;
    expect(within(first).getByText('Ann')).toBeInTheDocument();
    expect(within(first).getByText('Content')).toBeInTheDocument();
    expect(within(first).getByText('Hello')).toBeInTheDocument();
    expect(within(first).queryByText('Actions')).not.toBeInTheDocument();
    expect(within(first).getByRole('button', { name: 'Hide Ann' })).toBeInTheDocument();
  });

  it('accepts plain labels in column order', () => {
    render(
      <ModerationCards
        ariaLabel="Comments"
        columns={['User', 'Comment', 'Actions']}
        items={ROWS}
        getKey={(r) => r.id}
        renderCells={renderCells}
      />,
    );
    const first = within(screen.getByRole('list', { name: 'Comments' })).getAllByRole('listitem')[0] as HTMLElement;
    expect(within(first).getByText('Comment')).toBeInTheDocument();
  });

  it('shows the page empty message, and a busy state while loading', () => {
    const { rerender } = render(
      <ModerationCards ariaLabel="Posts" columns={[]} items={[]} getKey={() => 0} renderCells={() => []} emptyContent="Nothing to moderate" />,
    );
    expect(screen.getByText('Nothing to moderate')).toBeInTheDocument();

    rerender(<ModerationCards ariaLabel="Posts" columns={[]} items={[]} getKey={() => 0} renderCells={() => []} isLoading />);
    expect(screen.getAllByRole('status').some((el) => el.getAttribute('aria-busy') === 'true')).toBe(true);
  });
});
