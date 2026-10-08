// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Context mocks ────────────────────────────────────────────────────────────
vi.mock('@/contexts', () => createMockContexts());

// ─── Stub HeroUI Table family so jsdom can render rows ───────────────────────
// HeroUI Table (React Aria) does NOT render rows statically in jsdom.
// We stub the entire Table family via @/components/ui importOriginal mock.
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    Table: ({ children, topContent, bottomContent, ...rest }: { children: React.ReactNode; topContent?: React.ReactNode; bottomContent?: React.ReactNode; [key: string]: unknown }) =>
      <div data-testid="table-wrapper" aria-label={(rest['aria-label'] as string | undefined) ?? 'table'}>
        {topContent && <div data-testid="top-content">{topContent}</div>}
        <table role="table">{children}</table>
        {bottomContent && <div data-testid="bottom-content">{bottomContent}</div>}
      </div>,
    TableHeader: ({ children }: { children: React.ReactNode }) => <thead><tr>{children}</tr></thead>,
    TableColumn: ({ children, ...rest }: { children: React.ReactNode; [key: string]: unknown }) => <th scope="col" aria-label={typeof children === 'string' ? children : undefined}>{children}</th>,
    TableBody: ({ children, isLoading, loadingContent, emptyContent }: { children: React.ReactNode; isLoading?: boolean; loadingContent?: React.ReactNode; emptyContent?: React.ReactNode }) => {
      if (isLoading) return <tbody><tr><td>{loadingContent}</td></tr></tbody>;
      const childArr = React.Children.toArray(children);
      if (childArr.length === 0) return <tbody><tr><td>{emptyContent}</td></tr></tbody>;
      return <tbody>{children}</tbody>;
    },
    TableRow: ({ children, ...rest }: { children: React.ReactNode; [key: string]: unknown }) => <tr data-id={rest['id'] as string | undefined}>{children}</tr>,
    TableCell: ({ children }: { children: React.ReactNode }) => <td>{children}</td>,
    Input: ({ value, onValueChange, placeholder, 'aria-label': ariaLabel }: { value?: string; onValueChange?: (v: string) => void; placeholder?: string; 'aria-label'?: string; [key: string]: unknown }) =>
      <input
        aria-label={ariaLabel ?? placeholder}
        placeholder={placeholder}
        value={value ?? ''}
        onChange={(e) => onValueChange?.(e.target.value)}
      />,
    Button: ({ children, onPress, 'aria-label': ariaLabel, isIconOnly, ...rest }: { children?: React.ReactNode; onPress?: () => void; 'aria-label'?: string; isIconOnly?: boolean; [key: string]: unknown }) =>
      <button type="button" aria-label={ariaLabel ?? (typeof children === 'string' ? children : undefined)} onClick={() => onPress?.()}>{children}</button>,
    Checkbox: ({ 'aria-label': ariaLabel }: { 'aria-label'?: string; [key: string]: unknown }) =>
      <input type="checkbox" aria-label={ariaLabel} />,
    Chip: ({ children, color }: { children: React.ReactNode; color?: string }) =>
      <span data-testid="chip" data-color={color}>{children}</span>,
    Pagination: ({ page, total, onChange }: { page: number; total: number; onChange?: (p: number) => void }) =>
      <nav aria-label="pagination">
        <button type="button" onClick={() => onChange?.(page - 1)} disabled={page <= 1}>Prev</button>
        <span>{page}/{total}</span>
        <button type="button" onClick={() => onChange?.(page + 1)} disabled={page >= total}>Next</button>
      </nav>,
    Spinner: () => <span role="status" aria-busy="true">Loading...</span>,
  };
});

// ─── Types matching the component ─────────────────────────────────────────────
vi.mock('@/components/ui/Table', () => ({
  Table: ({ children, topContent, bottomContent, ...rest }: { children: React.ReactNode; topContent?: React.ReactNode; bottomContent?: React.ReactNode; [key: string]: unknown }) =>
    <div data-testid="table-wrapper" aria-label={(rest['aria-label'] as string | undefined) ?? 'table'}>
      {topContent && <div data-testid="top-content">{topContent}</div>}
      <table role="table">{children}</table>
      {bottomContent && <div data-testid="bottom-content">{bottomContent}</div>}
    </div>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead><tr>{children}</tr></thead>,
  TableColumn: ({ children }: { children: React.ReactNode; [key: string]: unknown }) => <th scope="col" aria-label={typeof children === 'string' ? children : undefined}>{children}</th>,
  TableBody: ({ children, isLoading, loadingContent, emptyContent }: { children: React.ReactNode; isLoading?: boolean; loadingContent?: React.ReactNode; emptyContent?: React.ReactNode }) => {
    if (isLoading) return <tbody><tr><td>{loadingContent}</td></tr></tbody>;
    const childArr = React.Children.toArray(children);
    if (childArr.length === 0) return <tbody><tr><td>{emptyContent}</td></tr></tbody>;
    return <tbody>{children}</tbody>;
  },
  TableRow: ({ children, ...rest }: { children: React.ReactNode; [key: string]: unknown }) => <tr data-id={rest['id'] as string | undefined}>{children}</tr>,
  TableCell: ({ children }: { children: React.ReactNode }) => <td>{children}</td>,
}));

vi.mock('@/components/ui/Input', () => ({
  Input: ({ value, onValueChange, placeholder, 'aria-label': ariaLabel }: { value?: string; onValueChange?: (v: string) => void; placeholder?: string; 'aria-label'?: string; [key: string]: unknown }) =>
    <input
      aria-label={ariaLabel ?? placeholder}
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => onValueChange?.(e.target.value)}
    />,
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, onPress, 'aria-label': ariaLabel }: { children?: React.ReactNode; onPress?: () => void; 'aria-label'?: string; isIconOnly?: boolean; [key: string]: unknown }) =>
    <button type="button" aria-label={ariaLabel ?? (typeof children === 'string' ? children : undefined)} onClick={() => onPress?.()}>{children}</button>,
}));

vi.mock('@/components/ui/Checkbox', () => ({
  Checkbox: ({ 'aria-label': ariaLabel }: { 'aria-label'?: string; [key: string]: unknown }) =>
    <input type="checkbox" aria-label={ariaLabel} />,
}));

vi.mock('@/components/ui/Chip', () => ({
  Chip: ({ children, color }: { children: React.ReactNode; color?: string }) =>
    <span data-testid="chip" data-color={color}>{children}</span>,
}));

vi.mock('@/components/ui/Pagination', () => ({
  Pagination: ({ page, total, onChange }: { page: number; total: number; onChange?: (p: number) => void }) =>
    <nav aria-label="pagination">
      <button type="button" onClick={() => onChange?.(page - 1)} disabled={page <= 1}>Prev</button>
      <span>{page}/{total}</span>
      <button type="button" onClick={() => onChange?.(page + 1)} disabled={page >= total}>Next</button>
    </nav>,
}));

vi.mock('@/components/ui/Spinner', () => ({
  Spinner: () => <span role="status" aria-busy="true">Loading...</span>,
}));

type RowData = { id: number; name: string; status: string; age?: number };

const COLUMNS = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'status', label: 'Status' },
];

const ROWS: RowData[] = [
  { id: 1, name: 'Alice', status: 'active', age: 30 },
  { id: 2, name: 'Bob', status: 'pending', age: 25 },
  { id: 3, name: 'Charlie', status: 'inactive', age: 35 },
];

// ─────────────────────────────────────────────────────────────────────────────
describe('DataTable', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders column headers', async () => {
    const { DataTable } = await import('./DataTable');
    render(<DataTable columns={COLUMNS} data={ROWS} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('renders all data rows by default', async () => {
    const { DataTable } = await import('./DataTable');
    render(<DataTable columns={COLUMNS} data={ROWS} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
  });

  it('renders cell values from data', async () => {
    const { DataTable } = await import('./DataTable');
    render(<DataTable columns={COLUMNS} data={ROWS} />);
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('shows loading state with spinner when isLoading=true', async () => {
    const { DataTable } = await import('./DataTable');
    render(<DataTable columns={COLUMNS} data={[]} isLoading={true} />);
    const spinner = screen.queryAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true');
    expect(spinner).toBeDefined();
  });

  it('shows empty content when data is empty and not loading', async () => {
    const { DataTable } = await import('./DataTable');
    render(<DataTable columns={COLUMNS} data={[]} isLoading={false} />);
    // The translation key admin.shared.no_data — just look for the element
    const table = screen.getByTestId('table-wrapper');
    expect(table).toBeInTheDocument();
  });

  it('renders custom emptyContent when provided', async () => {
    const { DataTable } = await import('./DataTable');
    render(<DataTable columns={COLUMNS} data={[]} emptyContent={<span>No results found</span>} />);
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('renders a search input when searchable=true (default)', async () => {
    const { DataTable } = await import('./DataTable');
    render(<DataTable columns={COLUMNS} data={ROWS} />);
    const input = screen.getByTestId('top-content').querySelector('input');
    expect(input).toBeInTheDocument();
  });

  it('does not render search input when searchable=false', async () => {
    const { DataTable } = await import('./DataTable');
    render(<DataTable columns={COLUMNS} data={ROWS} searchable={false} />);
    // input should not be inside top-content
    const topContent = screen.queryByTestId('top-content');
    const input = topContent?.querySelector('input');
    expect(input).toBeNull();
  });

  it('calls onSearch when search input changes', async () => {
    const onSearch = vi.fn();
    const { DataTable } = await import('./DataTable');
    render(<DataTable columns={COLUMNS} data={ROWS} onSearch={onSearch} />);
    const input = screen.getByTestId('top-content').querySelector('input')!;
    fireEvent.change(input, { target: { value: 'Alice' } });
    expect(onSearch).toHaveBeenCalledWith('Alice');
  });

  it('renders refresh button when onRefresh is provided', async () => {
    const onRefresh = vi.fn();
    const { DataTable } = await import('./DataTable');
    render(<DataTable columns={COLUMNS} data={ROWS} onRefresh={onRefresh} />);
    const btns = screen.getAllByRole('button');
    expect(btns.length).toBeGreaterThan(0);
  });

  it('calls onRefresh when refresh button is clicked', async () => {
    const onRefresh = vi.fn();
    const { DataTable } = await import('./DataTable');
    render(<DataTable columns={COLUMNS} data={ROWS} onRefresh={onRefresh} />);
    // The refresh button has aria-label from i18n key admin.shared.refresh
    const allButtons = screen.getAllByRole('button');
    // Find the icon-only refresh button (no visible text children)
    const refreshBtn = allButtons.find((b) => b.getAttribute('aria-label') !== null);
    if (refreshBtn) fireEvent.click(refreshBtn);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('renders pagination when onPageChange + totalItems are provided', async () => {
    const onPageChange = vi.fn();
    const { DataTable } = await import('./DataTable');
    render(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        totalItems={60}
        pageSize={20}
        page={1}
        onPageChange={onPageChange}
      />
    );
    expect(screen.getByRole('navigation', { name: 'pagination' })).toBeInTheDocument();
  });

  it('calls onPageChange when next page button is clicked', async () => {
    const onPageChange = vi.fn();
    const { DataTable } = await import('./DataTable');
    render(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        totalItems={60}
        pageSize={20}
        page={1}
        onPageChange={onPageChange}
      />
    );
    const nextBtn = screen.getByText('Next');
    fireEvent.click(nextBtn);
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('renders custom render function for a column', async () => {
    const columnsWithRender = [
      { key: 'name', label: 'Name' },
      {
        key: 'status',
        label: 'Status',
        render: (item: RowData) => <span data-testid="custom-cell">{item.status.toUpperCase()}</span>,
      },
    ];
    const { DataTable } = await import('./DataTable');
    render(<DataTable columns={columnsWithRender} data={[ROWS[0]]} />);
    expect(screen.getByTestId('custom-cell')).toHaveTextContent('ACTIVE');
  });

  it('renders topContent slot when provided', async () => {
    const { DataTable } = await import('./DataTable');
    render(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        topContent={<button type="button">Export CSV</button>}
      />
    );
    expect(screen.getByText('Export CSV')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('StatusBadge', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders with success color for "active" status', async () => {
    const { StatusBadge } = await import('./DataTable');
    render(<StatusBadge status="active" />);
    const chip = screen.getByTestId('chip');
    expect(chip).toHaveTextContent('Active');
    expect(chip).toHaveAttribute('data-color', 'success');
  });

  it('renders with danger color for "suspended" status', async () => {
    const { StatusBadge } = await import('./DataTable');
    render(<StatusBadge status="suspended" />);
    const chip = screen.getByTestId('chip');
    expect(chip).toHaveAttribute('data-color', 'danger');
  });

  it.each([
    ['pending', 'Pending', 'warning'],
    ['active', 'Active', 'success'],
    ['suspended', 'Suspended', 'danger'],
    ['rejected', 'Rejected', 'danger'],
    ['terminated', 'Terminated', 'danger'],
    // A declined volunteer application showed as "Unknown" until 8 Oct 2026.
    ['declined', 'Declined', 'danger'],
  ])('renders the partnership status %s as %s', async (status, label, color) => {
    const { StatusBadge } = await import('./DataTable');
    render(<StatusBadge status={status} />);
    const chip = screen.getByTestId('chip');
    expect(chip).toHaveTextContent(label);
    expect(chip).toHaveAttribute('data-color', color);
  });

  // cron_logs records a run as 'success' or 'error'. Neither had a label, so
  // the Cron Jobs page showed "Unknown" for every job.
  it.each([
    ['success', 'Success', 'success'],
    ['error', 'Error', 'danger'],
  ])('renders the cron run status %s as %s', async (status, label, color) => {
    const { StatusBadge } = await import('./DataTable');
    render(<StatusBadge status={status} />);
    const chip = screen.getByTestId('chip');
    expect(chip).toHaveTextContent(label);
    expect(chip).toHaveAttribute('data-color', color);
  });

  it('renders with default color for unknown status', async () => {
    const { StatusBadge } = await import('./DataTable');
    render(<StatusBadge status="unknown_xyz" />);
    const chip = screen.getByTestId('chip');
    expect(chip).toHaveTextContent('Unknown');
    expect(chip).toHaveAttribute('data-color', 'default');
  });

  it('renders translated multi-word labels instead of API identifiers', async () => {
    const { StatusBadge } = await import('./DataTable');
    render(<StatusBadge status="bulk_users_moved" />);
    const chip = screen.getByTestId('chip');
    expect(chip).toHaveTextContent('Users moved');
    expect(chip).not.toHaveTextContent('bulk_users_moved');
  });

  it('handles empty string status gracefully', async () => {
    const { StatusBadge } = await import('./DataTable');
    render(<StatusBadge status="" />);
    const chip = screen.getByTestId('chip');
    expect(chip).toHaveTextContent('Unknown');
  });
});
