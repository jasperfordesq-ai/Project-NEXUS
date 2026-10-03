// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Phone layout for the moderation tables (Feed Posts, Comments, Reviews,
 * Reports, Content Queue).
 *
 * Those pages build each row as an array of keyed `<TableCell>`s
 * (`renderCells(item)`) beside a `columns` list. On a phone a seven-column
 * table needs sideways scrolling, with the Hide / Delete / Resolve buttons off
 * the edge. This component takes the very same cells and lays each row out as
 * a card: the first cell as the heading, the others as label / value pairs,
 * and the `actions` cell along the bottom — so no page has to describe its
 * content twice. Desktop keeps the table unchanged.
 */

import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { Spinner } from '@/components/ui';
import { useMediaQuery } from '@/hooks/useMediaQuery';

export interface ModerationCardColumn {
  key: string;
  label: ReactNode;
}

interface ModerationCardsProps<T> {
  ariaLabel: string;
  /** `{ key, label }` pairs, or plain labels in the same order as the cells. */
  columns: Array<ModerationCardColumn | string>;
  items: T[];
  getKey: (item: T) => string | number;
  /** The page's own row builder: keyed `<TableCell>` elements, one per column. */
  renderCells: (item: T) => ReactElement[];
  isLoading?: boolean;
  emptyContent?: ReactNode;
  /** Key of the buttons cell (default `actions`). */
  actionsKey?: string;
}

/** True below the `md` breakpoint — when the moderation tables switch to cards. */
export function useModerationCards(): boolean {
  return useMediaQuery('(max-width: 767px)');
}

function cellContent(cell: ReactElement): ReactNode {
  return isValidElement<{ children?: ReactNode }>(cell) ? cell.props.children : null;
}

export function ModerationCards<T>({
  ariaLabel,
  columns,
  items,
  getKey,
  renderCells,
  isLoading = false,
  emptyContent,
  actionsKey = 'actions',
}: ModerationCardsProps<T>) {
  if (isLoading) {
    return (
      <div role="status" aria-busy="true" className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-divider/70 bg-surface p-6 text-center text-sm text-muted shadow-sm">
        {emptyContent}
      </div>
    );
  }

  const byKey = new Map<string, ReactNode>();
  for (const c of columns) if (typeof c !== 'string') byKey.set(c.key, c.label);
  const labelFor = (cell: ReactElement, index: number): ReactNode => {
    const keyed = byKey.get(String(cell.key));
    if (keyed !== undefined) return keyed;
    const positional = columns[index];
    return typeof positional === 'string' ? positional : '';
  };

  return (
    <ul className="space-y-3" aria-label={ariaLabel} data-testid="moderation-cards">
      {items.map((item) => {
        const cells = renderCells(item);
        const [title, ...rest] = cells;
        // Keep each cell's column position for plain-label column lists.
        const indexed = rest.map((cell, i) => ({ cell, index: i + 1 }));
        const actions = indexed.filter(({ cell }) => cell.key === actionsKey).map(({ cell }) => cell);
        const details = indexed.filter(({ cell }) => cell.key !== actionsKey);
        return (
          <li
            key={getKey(item)}
            className="rounded-2xl border border-divider/70 bg-surface p-4 shadow-sm shadow-black/[0.03]"
          >
            {title && <div className="min-w-0 text-sm">{cellContent(title)}</div>}
            {details.length > 0 && (
              <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                {details.map(({ cell, index }) => (
                  <div key={String(cell.key)} className="contents">
                    <dt className="text-xs font-medium text-muted">{labelFor(cell, index)}</dt>
                    <dd className="min-w-0 break-words text-foreground">{cellContent(cell)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {actions.map((cell) => (
              <div
                key={String(cell.key)}
                className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-divider/60 pt-3"
              >
                {cellContent(cell)}
              </div>
            ))}
          </li>
        );
      })}
    </ul>
  );
}
