// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Data Table
 * Reusable table with sorting, filtering, pagination, and bulk actions.
 * Built on HeroUI Table component.
 *
 * Two opt-in layouts for narrow screens (used by the broker panel):
 * - `stickyActions` pins the actions column to the right edge, so the buttons
 *   stay visible while a wide table scrolls sideways.
 * - `mobileCards` renders each row as a card below the `md` breakpoint (labels
 *   beside values, actions at the bottom) instead of a table that needs
 *   sideways scrolling on a phone.
 * Columns can also `hideBelow` a breakpoint to drop the least useful detail
 * on smaller screens.
 */

import { useState, useMemo, useCallback, type ReactNode } from 'react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useTranslation } from 'react-i18next';
import Search from 'lucide-react/icons/search';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { Spinner } from '@/components/ui/Spinner';
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  type Selection,
  type SortDescriptor,
} from '@/components/ui/Table';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ColumnBreakpoint = 'sm' | 'md' | 'lg' | 'xl' | '2xl';

export interface Column<T> {
  key: string;
  label: ReactNode;
  sortable?: boolean;
  isRowHeader?: boolean;
  render?: (item: T) => ReactNode;
  width?: number;
  /** Table layout: hide this column on screens narrower than the breakpoint. */
  hideBelow?: ColumnBreakpoint;
  /** The row's buttons. Defaults to `key === 'actions'`. Pinned by `stickyActions`, placed last in cards. */
  isActions?: boolean;
  /** Card layout: leave this column out of the card. */
  hideInCard?: boolean;
}

// Literal class names so Tailwind generates them.
const HIDE_BELOW_CLASS: Record<ColumnBreakpoint, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
  '2xl': 'hidden 2xl:table-cell',
};
const STICKY_ACTIONS_CELL = 'sticky right-0 z-[1] bg-surface shadow-[-10px_0_10px_-10px_rgba(0,0,0,0.25)]';
const STICKY_ACTIONS_HEAD = 'sticky right-0 z-[2] bg-surface-secondary shadow-[-10px_0_10px_-10px_rgba(0,0,0,0.25)]';

function isActionsColumn<T>(col: Column<T>): boolean {
  return col.isActions ?? col.key === 'actions';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface DataTableProps<T extends Record<string, any>> {
  columns: Column<T>[];
  data: T[];
  keyField?: string;
  isLoading?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  totalItems?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  onSearch?: (query: string) => void;
  onRefresh?: () => void;
  selectable?: boolean;
  onSelectionChange?: (selectedKeys: Set<string>) => void;
  /**
   * Optional controlled selection. When provided, the table operates in
   * controlled mode and reflects this set on the row checkboxes — including
   * clearing them after the parent resets state (e.g. after a bulk action).
   * Without this, HeroUI's Table runs uncontrolled and row checkboxes can
   * stay visually checked even after the parent's selectedIds is empty.
   */
  selectedKeys?: Set<string>;
  topContent?: ReactNode;
  emptyContent?: ReactNode;
  /** Pin the actions column to the right edge while the table scrolls sideways. */
  stickyActions?: boolean;
  /** Below the `md` breakpoint, show each row as a card instead of a table row. */
  mobileCards?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  keyField = 'id',
  isLoading = false,
  searchable = true,
  searchPlaceholder,
  totalItems,
  page = 1,
  pageSize = 20,
  onPageChange,
  onSearch,
  onRefresh,
  selectable = false,
  onSelectionChange,
  selectedKeys,
  topContent,
  emptyContent,
  stickyActions = false,
  mobileCards = false,
}: DataTableProps<T>) {
  const { t } = useTranslation('admin_nav');
  const isPhone = useMediaQuery('(max-width: 767px)');
  const showCards = mobileCards && isPhone;
  const [searchValue, setSearchValue] = useState('');
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor | undefined>(undefined);

  const totalPages = totalItems ? Math.ceil(totalItems / pageSize) : 1;
  const effectiveSearchPlaceholder = searchPlaceholder ?? t('shared.search');

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchValue(value);
      onSearch?.(value);
    },
    [onSearch]
  );

  const handleSelectionChange = useCallback(
    (keys: Selection) => {
      if (keys === 'all') {
        onSelectionChange?.(new Set(data.map((item) => String(item[keyField]))));
      } else {
        onSelectionChange?.(keys as Set<string>);
      }
    },
    [data, keyField, onSelectionChange]
  );

  // Sort data locally if no server-side sorting
  const sortedData = useMemo(() => {
    if (!sortDescriptor?.column) return data;
    const { column, direction } = sortDescriptor;
    return [...data].sort((a, b) => {
      const aVal = a[column as string];
      const bVal = b[column as string];
      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      const cmp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
      return direction === 'ascending' ? cmp : -cmp;
    });
  }, [data, sortDescriptor]);

  // Top content (search + actions)
  const tableTopContent = useMemo(
    () => (
      <div className="flex min-w-0 flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:w-auto">
          {searchable && (
            <Input
              className="w-full sm:max-w-sm"
              type="search"
              name="datatable-search"
              autoComplete="off"
              placeholder={effectiveSearchPlaceholder}
              aria-label={effectiveSearchPlaceholder}
              startContent={<Search size={16} className="text-muted" />}
              value={searchValue}
              onValueChange={handleSearchChange}
              size="sm"
              variant="secondary"
              classNames={{ inputWrapper: 'bg-surface-secondary/40 border-divider/70' }}
            />
          )}
          {onRefresh && (
            <Button
              isIconOnly
              variant="tertiary"
              size="sm"
              onPress={onRefresh}
              aria-label={t('shared.refresh')}
              className="bg-surface-secondary/70 text-muted"
            >
              <RefreshCw size={16} />
            </Button>
          )}
        </div>
        {topContent && <div className="flex flex-wrap items-center gap-2">{topContent}</div>}
      </div>
    ),
    [searchable, effectiveSearchPlaceholder, searchValue, handleSearchChange, onRefresh, topContent, t],
  );

  // Bottom content (pagination)
  const tableBottomContent = useMemo(() => {
    if (!onPageChange || totalPages <= 1) return null;
    return (
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-2 py-2">
        <span className="text-sm text-muted">
          {totalItems ? t('shared.total_count', { count: totalItems }) : ''}
        </span>
        <Pagination
          total={totalPages}
          page={page}
          onChange={onPageChange}
          showControls
          size="sm"
        />
      </div>
    );
  }, [onPageChange, totalPages, page, totalItems, t])

  function columnClass(col: Column<T>, head: boolean): string | undefined {
    const parts: string[] = [];
    if (col.hideBelow) parts.push(HIDE_BELOW_CLASS[col.hideBelow]);
    if (stickyActions && isActionsColumn(col)) parts.push(head ? STICKY_ACTIONS_HEAD : STICKY_ACTIONS_CELL);
    return parts.length ? parts.join(' ') : undefined;
  }

  if (showCards) {
    const titleColumn = columns.find((c) => c.isRowHeader) ?? columns[0];
    const actionColumns = columns.filter((c) => isActionsColumn(c));
    const detailColumns = columns.filter((c) => c !== titleColumn && !isActionsColumn(c) && !c.hideInCard);
    const cell = (col: Column<T>, item: T): ReactNode =>
      col.render ? col.render(item) : ((item[col.key] as ReactNode) ?? '—');
    const selection = selectable && selectedKeys && onSelectionChange ? selectedKeys : null;
    const toggle = (key: string, on: boolean) => {
      const next = new Set(selection ?? []);
      if (on) next.add(key);
      else next.delete(key);
      onSelectionChange?.(next);
    };

    return (
      <div className="min-w-0 space-y-3" data-testid="data-table-cards">
        {tableTopContent}
        {isLoading ? (
          <div role="status" aria-busy="true" aria-label={t('shared.loading')} className="flex justify-center py-10">
            <Spinner size="lg" />
          </div>
        ) : sortedData.length === 0 ? (
          <div className="rounded-2xl border border-divider/70 bg-surface p-6 text-center text-sm text-muted shadow-sm">
            {emptyContent || t('shared.no_data')}
          </div>
        ) : (
          <ul className="space-y-3" aria-label={t('shared.data_table')}>
            {sortedData.map((item) => {
              const key = String(item[keyField]);
              return (
                <li
                  key={key}
                  className="rounded-2xl border border-divider/70 bg-surface p-4 shadow-sm shadow-black/[0.03]"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    {selection && (
                      <Checkbox
                        aria-label={t('shared.select_row', { id: key })}
                        isSelected={selection.has(key)}
                        onChange={(on) => toggle(key, on)}
                        className="mt-0.5"
                        // A visible edge: the default box is too faint on a white card (WCAG 1.4.11).
                        classNames={{ wrapper: 'border border-foreground/60' }}
                      />
                    )}
                    <div className="min-w-0 flex-1 text-sm">{titleColumn ? cell(titleColumn, item) : key}</div>
                  </div>
                  {detailColumns.length > 0 && (
                    <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                      {detailColumns.map((col) => (
                        <div key={col.key} className="contents">
                          <dt className="text-xs font-medium text-muted">{col.label}</dt>
                          <dd className="min-w-0 break-words text-foreground">{cell(col, item)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {actionColumns.map((col) => (
                    <div
                      key={col.key}
                      className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-divider/60 pt-3"
                    >
                      {cell(col, item)}
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
        {tableBottomContent}
      </div>
    );
  }

  return (
    <Table
      aria-label={t('shared.data_table')}
      selectionMode={selectable ? 'multiple' : 'none'}
      selectedKeys={selectable && selectedKeys ? (selectedKeys as unknown as Selection) : undefined}
      onSelectionChange={selectable ? handleSelectionChange : undefined}
      sortDescriptor={sortDescriptor}
      onSortChange={setSortDescriptor}
      topContent={tableTopContent}
      topContentPlacement="outside"
      bottomContent={tableBottomContent}
      bottomContentPlacement="outside"
      classNames={{
        base: 'min-w-0',
        wrapper: 'max-w-full overflow-x-auto border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]',
        table: 'min-w-max',
        th: 'whitespace-nowrap bg-surface-secondary/70 text-xs font-semibold uppercase tracking-normal text-muted',
        td: 'align-top text-sm',
      }}
    >
      <TableHeader>
        {selectable ? (
          <TableColumn className="w-10 pr-0" aria-label={t('shared.select_all_rows')}>
            <Checkbox aria-label={t('shared.select_all_rows')} slot="selection" />
          </TableColumn>
        ) : null}
        {columns.map((col, index) => (
          <TableColumn
            key={col.key}
            allowsSorting={col.sortable}
            isRowHeader={col.isRowHeader ?? index === 0}
            width={col.width}
            scope="col"
            className={columnClass(col, true)}
          >
            {col.label}
          </TableColumn>
        ))}
      </TableHeader>
      <TableBody
        isLoading={isLoading}
        loadingContent={
          <div role="status" aria-busy="true" aria-label={t('shared.loading')}>
            <Spinner size="lg" />
          </div>
        }
        emptyContent={
          emptyContent || (
            <span>
              <span>{t('shared.no_data')}</span>
              <span className="sr-only">{t('shared.no_data_available')}</span>
            </span>
          )
        }
      >
        {sortedData.map((item) => (
          <TableRow key={String(item[keyField])} id={String(item[keyField])}>
            {selectable ? (
              <TableCell className="w-10 pr-0">
                <Checkbox
                  aria-label={t('shared.select_row', { id: String(item[keyField]) })}
                  slot="selection"
                  variant="secondary"
                />
              </TableCell>
            ) : null}
            {columns.map((col) => (
              <TableCell key={col.key} className={columnClass(col, false)}>
                {col.render
                  ? col.render(item as T)
                  : (item[col.key] as ReactNode) ?? '—'}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default DataTable;

// ─────────────────────────────────────────────────────────────────────────────
// Status Badge helper
// ─────────────────────────────────────────────────────────────────────────────

const statusColorMap: Record<string, 'success' | 'warning' | 'danger' | 'default' | 'primary' | 'secondary'> = {
  active: 'success',
  approved: 'success',
  completed: 'success',
  published: 'success',
  sent: 'success',
  success: 'success',
  pending: 'warning',
  draft: 'default',
  scheduled: 'primary',
  suspended: 'danger',
  terminated: 'danger',
  banned: 'danger',
  rejected: 'danger',
  failed: 'danger',
  error: 'danger',
  inactive: 'default',
  idle: 'default',
  cancelled: 'danger',
  critical: 'danger',
  high: 'warning',
  in_progress: 'primary',
  in_review: 'warning',
  investigating: 'warning',
  low: 'default',
  medium: 'primary',
  open: 'warning',
  planned: 'default',
  processing: 'primary',
  resolved: 'success',
  // Super admin audit action types
  user_created: 'success',
  user_moved: 'primary',
  tenant_created: 'success',
  tenant_updated: 'primary',
  bulk_users_moved: 'warning',
  bulk_tenants_updated: 'warning',
  federation_lockdown: 'danger',
  federation_updated: 'secondary',
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation('admin_nav');
  const safeStatus = status || 'unknown';
  const normalizedStatus = safeStatus.toLowerCase();
  const color = statusColorMap[normalizedStatus] || 'default';
  const statusLabels: Record<string, string> = {
    active: t('shared.statuses.active'),
    approved: t('shared.statuses.approved'),
    banned: t('shared.statuses.banned'),
    bulk_tenants_updated: t('shared.statuses.bulk_tenants_updated'),
    bulk_users_moved: t('shared.statuses.bulk_users_moved'),
    completed: t('shared.statuses.completed'),
    draft: t('shared.statuses.draft'),
    error: t('shared.statuses.error'),
    failed: t('shared.statuses.failed'),
    federation_lockdown: t('shared.statuses.federation_lockdown'),
    federation_updated: t('shared.statuses.federation_updated'),
    idle: t('shared.statuses.idle'),
    cancelled: t('shared.statuses.cancelled'),
    critical: t('shared.statuses.critical'),
    high: t('shared.statuses.high'),
    in_progress: t('shared.statuses.in_progress'),
    in_review: t('shared.statuses.in_review'),
    investigating: t('shared.statuses.investigating'),
    low: t('shared.statuses.low'),
    medium: t('shared.statuses.medium'),
    open: t('shared.statuses.open'),
    planned: t('shared.statuses.planned'),
    processing: t('shared.statuses.processing'),
    resolved: t('shared.statuses.resolved'),
    inactive: t('shared.statuses.inactive'),
    pending: t('shared.statuses.pending'),
    published: t('shared.statuses.published'),
    rejected: t('shared.statuses.rejected'),
    scheduled: t('shared.statuses.scheduled'),
    sent: t('shared.statuses.sent'),
    success: t('shared.statuses.success'),
    suspended: t('shared.statuses.suspended'),
    terminated: t('shared.statuses.terminated'),
    tenant_created: t('shared.statuses.tenant_created'),
    tenant_updated: t('shared.statuses.tenant_updated'),
    user_created: t('shared.statuses.user_created'),
    user_moved: t('shared.statuses.user_moved'),
  };
  return (
    <Chip size="sm" variant="soft" color={color}>
      {statusLabels[normalizedStatus] ?? t('shared.statuses.unknown')}
    </Chip>
  );
}
