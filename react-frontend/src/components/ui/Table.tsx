// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import {
  Children,
  cloneElement,
  createContext,
  Fragment,
  isValidElement,
  type ComponentPropsWithoutRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
} from 'react';
import { Table as HeroUITable } from '@heroui/react/table';

type HeroUITableProps = ComponentPropsWithoutRef<typeof HeroUITable>;
type HeroUITableContentProps = ComponentPropsWithoutRef<typeof HeroUITable.Content>;
type HeroUITableHeaderProps = ComponentPropsWithoutRef<typeof HeroUITable.Header>;
type HeroUITableColumnProps = ComponentPropsWithoutRef<typeof HeroUITable.Column>;
type HeroUITableBodyProps = ComponentPropsWithoutRef<typeof HeroUITable.Body>;
type HeroUITablerowProps = ComponentPropsWithoutRef<typeof HeroUITable.Row>;
type HeroUITableCellProps = ComponentPropsWithoutRef<typeof HeroUITable.Cell>;

type TableColor = 'danger' | 'default' | 'primary' | 'secondary' | 'success' | 'warning';
type TableLayout = 'auto' | 'fixed';
type TableRadius = '2xl' | '3xl' | 'full' | 'lg' | 'md' | 'none' | 'sm' | 'xl';
type TableShadow = 'lg' | 'md' | 'none' | 'sm';

type TableClassNames = {
  base?: string;
  wrapper?: string;
  table?: string;
  thead?: string;
  tbody?: string;
  tr?: string;
  th?: string;
  td?: string;
};

export type TableProps = Omit<
  HeroUITableProps,
  'children' | 'className' | 'onKeyDownCapture' | 'variant'
> & {
  'aria-label'?: string;
  bottomContent?: ReactNode;
  bottomContentPlacement?: 'inside' | 'outside';
  children?: ReactNode;
  className?: string;
  classNames?: TableClassNames;
  color?: TableColor;
  defaultSelectedKeys?: HeroUITableContentProps['defaultSelectedKeys'];
  disabledBehavior?: HeroUITableContentProps['disabledBehavior'];
  disabledKeys?: HeroUITableContentProps['disabledKeys'];
  disallowEmptySelection?: HeroUITableContentProps['disallowEmptySelection'];
  fullWidth?: boolean;
  hideHeader?: boolean;
  isCompact?: boolean;
  isHeaderSticky?: boolean;
  isKeyboardNavigationDisabled?: boolean;
  isStriped?: boolean;
  layout?: TableLayout;
  /**
   * Collapse rows into stacked cards on phones (<640px), each cell prefixed
   * with its column header. Opt-in per table: suits record-per-row data
   * (transactions, campaigns); keep the default horizontal scroll for dense
   * comparison grids. Desktop rendering is unchanged.
   */
  mobileCards?: boolean;
  onKeyDownCapture?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onRowAction?: HeroUITableContentProps['onRowAction'];
  onSelectionChange?: HeroUITableContentProps['onSelectionChange'];
  onSortChange?: HeroUITableContentProps['onSortChange'];
  radius?: TableRadius;
  removeWrapper?: boolean;
  selectedKeys?: HeroUITableContentProps['selectedKeys'];
  selectionBehavior?: HeroUITableContentProps['selectionBehavior'];
  selectionMode?: HeroUITableContentProps['selectionMode'];
  shadow?: TableShadow;
  sortDescriptor?: HeroUITableContentProps['sortDescriptor'];
  topContent?: ReactNode;
  topContentPlacement?: 'inside' | 'outside';
  variant?: 'default' | 'primary' | 'secondary' | 'flat' | string;
};

export type TableHeaderProps = HeroUITableHeaderProps;
export type TableColumnProps = Omit<HeroUITableColumnProps, 'align' | 'className' | 'scope' | 'title'> & {
  align?: 'center' | 'end' | 'left' | 'right' | 'start' | string;
  className?: string;
  scope?: string;
  title?: string;
};
export type TableBodyProps<T extends object = object> = Omit<HeroUITableBodyProps, 'children' | 'isLoading' | 'items' | 'renderEmptyState'> & {
  children?: ReactNode | ((item: T) => ReactNode);
  emptyContent?: ReactNode;
  isLoading?: boolean;
  items?: Iterable<T>;
  loadingContent?: ReactNode;
  loadingState?: 'idle' | 'loading' | 'loadingMore' | 'sorting' | 'error' | 'filtering';
  renderEmptyState?: HeroUITableBodyProps['renderEmptyState'];
};
export type TableRowProps = HeroUITablerowProps;
export type TableCellProps = Omit<HeroUITableCellProps, 'className' | 'title'> & {
  className?: string;
  title?: string;
};
export type Selection = HeroUITableContentProps['selectedKeys'];
export type SortDescriptor = HeroUITableContentProps['sortDescriptor'];

function combineClasses(...classes: Array<string | false | undefined>): string | undefined {
  const className = classes.filter(Boolean).join(' ');

  return className || undefined;
}

type TableCompatibilityContextValue = {
  classNames?: TableClassNames;
  hideHeader: boolean;
  isCompact: boolean;
  isHeaderSticky: boolean;
  isStriped: boolean;
};

const TableCompatibilityContext = createContext<TableCompatibilityContextValue>({
  hideHeader: false,
  isCompact: false,
  isHeaderSticky: false,
  isStriped: false,
});

function mergeClassNameProp<T>(inheritedClassName: string | undefined, className: T): T {
  if (!inheritedClassName) {
    return className;
  }

  if (typeof className === 'function') {
    const renderClassName = className as (renderProps: unknown) => string;

    return ((renderProps: unknown) =>
      combineClasses(inheritedClassName, renderClassName(renderProps))) as T;
  }

  return combineClasses(
    inheritedClassName,
    typeof className === 'string' ? className : undefined
  ) as T;
}

function mapVariant(variant?: TableProps['variant']): HeroUITableProps['variant'] {
  return variant === 'flat' || variant === 'secondary' ? 'secondary' : 'primary';
}

const colorClassNames: Record<TableColor, string> = {
  danger: '[&_[data-selected=true]_[data-slot=table-cell]]:!bg-danger-soft',
  default: '[&_[data-selected=true]_[data-slot=table-cell]]:!bg-default/50',
  primary: '[&_[data-selected=true]_[data-slot=table-cell]]:!bg-accent-soft',
  secondary: '[&_[data-selected=true]_[data-slot=table-cell]]:!bg-surface-secondary',
  success: '[&_[data-selected=true]_[data-slot=table-cell]]:!bg-success-soft',
  warning: '[&_[data-selected=true]_[data-slot=table-cell]]:!bg-warning-soft',
};

const radiusClassNames: Record<TableRadius, string> = {
  '2xl': '!rounded-2xl',
  '3xl': '!rounded-3xl',
  full: '!rounded-full',
  lg: '!rounded-lg',
  md: '!rounded-md',
  none: '!rounded-none',
  sm: '!rounded-sm',
  xl: '!rounded-xl',
};

const shadowClassNames: Record<TableShadow, string> = {
  lg: '!shadow-lg',
  md: '!shadow-md',
  none: '!shadow-none',
  sm: '!shadow-sm',
};

const tableNavigationKeys = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
]);

/**
 * Stamps each body cell with its column header text as `data-label`, which the
 * `.nexus-table-cards` phone CSS renders as the cell's leading label. Reads the
 * DOM (rather than threading React context through header/body) so it works
 * for both static children and `items`-driven collection rendering. Rows whose
 * cell count differs from the header count (e.g. a spanning empty-state cell)
 * are left unstamped.
 */
function useMobileCardLabels(enabled: boolean) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;

    if (!enabled || !container || typeof MutationObserver === 'undefined') {
      return;
    }

    const stampLabels = () => {
      const table = container.querySelector('table');

      if (!table) {
        return;
      }

      const headers = Array.from(table.querySelectorAll('thead th')).map(
        (header) => header.textContent?.trim() ?? ''
      );

      table.querySelectorAll('tbody tr').forEach((row) => {
        const cells = Array.from(row.children).filter(
          (cell): cell is HTMLElement => cell instanceof HTMLElement
        );
        const rowMatchesColumns = cells.length === headers.length;

        cells.forEach((cell, index) => {
          const label = rowMatchesColumns ? headers[index] : undefined;

          if (label) {
            cell.setAttribute('data-label', label);
          } else {
            cell.removeAttribute('data-label');
          }
        });
      });
    };

    stampLabels();

    const observer = new MutationObserver(stampLabels);
    observer.observe(container, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [enabled]);

  return containerRef;
}

function preventTableKeyboardNavigation(event: ReactKeyboardEvent<HTMLElement>) {
  if (!tableNavigationKeys.has(event.key)) {
    return;
  }

  const target = event.target;

  if (
    target instanceof Element &&
    target.closest('a, button, input, select, textarea, [contenteditable="true"]')
  ) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
}

export function Table({
  'aria-label': ariaLabel,
  bottomContent,
  bottomContentPlacement = 'inside',
  children,
  className,
  classNames,
  color,
  defaultSelectedKeys,
  disabledBehavior,
  disabledKeys,
  disallowEmptySelection,
  fullWidth = true,
  hideHeader = false,
  isCompact = false,
  isHeaderSticky = false,
  isKeyboardNavigationDisabled = false,
  isStriped = false,
  layout,
  mobileCards = false,
  onKeyDownCapture,
  onRowAction,
  onSelectionChange,
  onSortChange,
  radius,
  removeWrapper = false,
  selectedKeys,
  selectionBehavior,
  selectionMode,
  shadow,
  sortDescriptor,
  topContent,
  topContentPlacement = 'inside',
  variant,
  ...props
}: TableProps) {
  const mobileCardLabelsRef = useMobileCardLabels(mobileCards);
  const compatibilityValue: TableCompatibilityContextValue = {
    classNames,
    hideHeader,
    isCompact,
    isHeaderSticky,
    isStriped,
  };
  const hasBottomContent = bottomContent !== null && bottomContent !== undefined;
  const tableContent = (
    <HeroUITable.Content
      aria-label={ariaLabel}
      className={combineClasses(
        fullWidth ? '!w-full' : '!w-auto',
        layout === 'fixed' ? 'table-fixed' : layout === 'auto' ? 'table-auto' : undefined,
        classNames?.table
      )}
      data-keyboard-navigation-disabled={isKeyboardNavigationDisabled || undefined}
      defaultSelectedKeys={defaultSelectedKeys}
      disabledBehavior={disabledBehavior}
      disabledKeys={disabledKeys}
      disallowEmptySelection={disallowEmptySelection}
      onRowAction={onRowAction}
      onSelectionChange={onSelectionChange}
      onSortChange={onSortChange}
      selectedKeys={selectedKeys}
      selectionBehavior={selectionBehavior}
      selectionMode={selectionMode}
      sortDescriptor={sortDescriptor}
    >
      {children}
    </HeroUITable.Content>
  );
  const bottomInside =
    hasBottomContent && bottomContentPlacement === 'inside' ? (
      <HeroUITable.Footer>{bottomContent}</HeroUITable.Footer>
    ) : null;
  const tableWithInsideContent = (
    <>
      {topContentPlacement === 'inside' ? topContent : null}
      {tableContent}
      {bottomInside}
    </>
  );

  const table = (
    <HeroUITable
      className={combineClasses(
        fullWidth ? '!w-full' : '!w-fit max-w-full',
        color ? colorClassNames[color] : undefined,
        !removeWrapper && radius ? radiusClassNames[radius] : undefined,
        !removeWrapper && shadow ? shadowClassNames[shadow] : undefined,
        removeWrapper && 'overflow-x-auto !rounded-none !bg-transparent !p-0 !shadow-none',
        classNames?.base,
        className
      )}
      data-color={color}
      onKeyDownCapture={
        isKeyboardNavigationDisabled
          ? (event: ReactKeyboardEvent<HTMLDivElement>) => {
              preventTableKeyboardNavigation(event);
              onKeyDownCapture?.(event);
            }
          : onKeyDownCapture
      }
      variant={mapVariant(variant)}
      {...props}
    >
      <TableCompatibilityContext.Provider value={compatibilityValue}>
        {topContentPlacement === 'outside' ? topContent : null}
        {removeWrapper ? (
          tableWithInsideContent
        ) : (
          <HeroUITable.ScrollContainer
            className={combineClasses(
              fullWidth ? '!w-full' : '!w-auto max-w-full',
              classNames?.wrapper
            )}
          >
            {tableWithInsideContent}
          </HeroUITable.ScrollContainer>
        )}
        {hasBottomContent && bottomContentPlacement === 'outside' ? (
          <HeroUITable.Footer>{bottomContent}</HeroUITable.Footer>
        ) : null}
      </TableCompatibilityContext.Provider>
    </HeroUITable>
  );

  if (!mobileCards) {
    return table;
  }

  // display:contents keeps this label-stamping anchor out of the layout, so
  // opting in cannot shift desktop rendering.
  return (
    <div className="contents nexus-table-cards" ref={mobileCardLabelsRef}>
      {table}
    </div>
  );
}

function getAlignClass(align?: TableColumnProps['align']): string | undefined {
  if (align === 'center') {
    return 'text-center';
  }

  if (align === 'end' || align === 'right') {
    return 'text-right';
  }

  return undefined;
}

export function TableColumn({ align, className, scope: _scope, ...props }: TableColumnProps) {
  const compatibility = useContext(TableCompatibilityContext);

  return (
    <HeroUITable.Column
      className={combineClasses(
        // Column headings are short labels; wrapping them mid-word
        // ("Severit/y") is never what anyone wants.
        'whitespace-nowrap',
        compatibility.classNames?.th,
        getAlignClass(align),
        className
      )}
      {...props}
    />
  );
}

function withDefaultRowHeader(children: TableHeaderProps['children']) {
  if (typeof children === 'function') {
    return children;
  }

  const columns = Children.toArray(children);

  if (
    columns.some(
      (child) =>
        isValidElement<Partial<TableColumnProps>>(child) &&
        Boolean(child.props.isRowHeader)
    )
  ) {
    return children;
  }

  let didSetRowHeader = false;

  return columns.map((child) => {
    if (
      didSetRowHeader ||
      !isValidElement<Partial<TableColumnProps>>(child) ||
      child.type === Fragment
    ) {
      return child;
    }

    didSetRowHeader = true;
    return cloneElement(child, { isRowHeader: true });
  });
}

export function TableHeader({ children, className, ...props }: TableHeaderProps) {
  const compatibility = useContext(TableCompatibilityContext);
  const compatibilityClassName = combineClasses(
    compatibility.hideHeader && 'sr-only',
    compatibility.isHeaderSticky && 'sticky top-0 z-20 [&>tr]:shadow-sm',
    compatibility.classNames?.thead
  );

  return (
    <HeroUITable.Header
      className={mergeClassNameProp(compatibilityClassName, className)}
      {...props}
    >
      {withDefaultRowHeader(children)}
    </HeroUITable.Header>
  );
}

export function TableBody<T extends object = object>({
  children,
  className,
  emptyContent,
  isLoading: isLoadingProp,
  loadingContent,
  loadingState,
  renderEmptyState,
  ...props
}: TableBodyProps<T>) {
  const compatibility = useContext(TableCompatibilityContext);
  const isLoading = isLoadingProp || loadingState === 'loading' || loadingState === 'loadingMore';
  const resolvedRenderEmptyState =
    renderEmptyState ??
    (isLoading && loadingContent
      ? () => loadingContent
      : emptyContent
        ? () => emptyContent
        : undefined);

  return (
    <HeroUITable.Body
      className={mergeClassNameProp(
        compatibility.classNames?.tbody,
        className
      ) as HeroUITableBodyProps['className']}
      renderEmptyState={resolvedRenderEmptyState}
      {...(props as HeroUITableBodyProps)}
    >
      {children as HeroUITableBodyProps['children']}
    </HeroUITable.Body>
  );
}

export function TableRow({ className, ...props }: TableRowProps) {
  const compatibility = useContext(TableCompatibilityContext);
  const compatibilityClassName = combineClasses(
    compatibility.isStriped &&
      'even:[&:not(:hover):not([data-hovered=true]):not([data-selected=true])_[data-slot=table-cell]]:bg-surface-secondary',
    compatibility.classNames?.tr
  );

  return (
    <HeroUITable.Row
      className={mergeClassNameProp(
        compatibilityClassName,
        className
      ) as HeroUITablerowProps['className']}
      {...props}
    />
  );
}

export function TableCell({ className, title: _title, ...props }: TableCellProps) {
  const compatibility = useContext(TableCompatibilityContext);

  return (
    <HeroUITable.Cell
      className={combineClasses(
        compatibility.isCompact && '!py-1',
        compatibility.classNames?.td,
        className
      )}
      {...props}
    />
  );
}
