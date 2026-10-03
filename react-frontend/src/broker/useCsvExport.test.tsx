// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('@/contexts', () => ({ useToast: () => mockToast }));

import { buildCsv, collectRows, useCsvExport, type CsvColumn } from './useCsvExport';

interface Row { id: number; name: string; note: string | null }
const columns: CsvColumn<Row>[] = [
  { label: 'ID', value: (r) => r.id },
  { label: 'Name', value: (r) => r.name },
  { label: 'Note', value: (r) => r.note },
];

describe('buildCsv', () => {
  it('writes a header, quotes commas/quotes/newlines, and blanks nulls', () => {
    const csv = buildCsv(columns, [
      { id: 1, name: 'Nolan, Priya', note: null },
      { id: 2, name: 'He said "hi"', note: 'line1\nline2' },
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.replace('﻿', '').trimEnd().split('\r\n');
    expect(lines[0]).toBe('ID,Name,Note');
    expect(lines[1]).toBe('1,"Nolan, Priya",');
    expect(lines[2]).toBe('2,"He said ""hi""","line1\nline2"');
  });

  it('defuses spreadsheet formulas at the start of a cell', () => {
    const csv = buildCsv(columns, [{ id: 3, name: '=HYPERLINK("x")', note: '-1+1' }]);
    expect(csv).toContain(`'=HYPERLINK(""x"")`);
    expect(csv).toContain(`'-1+1`);
  });
});

describe('collectRows', () => {
  it('pages until the endpoint runs out', async () => {
    const fetchPage = vi.fn(async (page: number) => ({
      rows: page < 3 ? [{ id: page, name: `p${page}`, note: null }] : [],
      hasMore: page < 3,
    }));
    const { rows, truncated } = await collectRows(fetchPage);
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
    expect(truncated).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('stops at the cap and says so when more exists', async () => {
    const fetchPage = vi.fn(async (page: number) => ({
      rows: Array.from({ length: 3 }, (_, i) => ({ id: page * 10 + i, name: 'x', note: null })),
      hasMore: true,
    }));
    const { rows, truncated } = await collectRows(fetchPage, 5);
    expect(rows).toHaveLength(5);
    expect(truncated).toBe(true);
  });
});

describe('useCsvExport', () => {
  const page = async () => ({ rows: [{ id: 1, name: 'A', note: null }], hasMore: false });

  it('downloads a timestamped file and reports the row count', async () => {
    const download = vi.fn();
    const { result } = renderHook(() => useCsvExport(download));
    await act(() => result.current.run({ filename: 'archive_flagged', columns, fetchPage: page }));
    expect(download).toHaveBeenCalledTimes(1);
    const [name, text] = download.mock.calls[0] as [string, string];
    expect(name).toMatch(/^archive_flagged_\d{4}-\d{2}-\d{2}_\d{4}\.csv$/);
    expect(text).toContain('1,A,');
    expect(mockToast.success).toHaveBeenCalledWith('Rows exported: 1');
    expect(result.current.exporting).toBe(false);
  });

  it('warns when the cap cut the export short', async () => {
    const download = vi.fn();
    const { result } = renderHook(() => useCsvExport(download));
    const big = async () => ({ rows: [{ id: 1, name: 'A', note: null }, { id: 2, name: 'B', note: null }], hasMore: true });
    await act(() => result.current.run({ filename: 'x', columns, fetchPage: big, cap: 1 }));
    expect(mockToast.warning).toHaveBeenCalledWith(expect.stringContaining('Only the first 1 rows'));
  });

  it('says there is nothing to export instead of downloading an empty file', async () => {
    const download = vi.fn();
    const { result } = renderHook(() => useCsvExport(download));
    await act(() => result.current.run({ filename: 'x', columns, fetchPage: async () => ({ rows: [], hasMore: false }) }));
    expect(download).not.toHaveBeenCalled();
    expect(mockToast.info).toHaveBeenCalledWith('There is nothing to export.');
  });

  it('reports a failed page as a failed export, never a partial file', async () => {
    const download = vi.fn();
    const { result } = renderHook(() => useCsvExport(download));
    await act(() => result.current.run({ filename: 'x', columns, fetchPage: async () => { throw new Error('boom'); } }));
    expect(download).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith('The export could not be completed.');
  });
});
