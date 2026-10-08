// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import { buildCsv, correctedFile, fileToBase64, problemsFile, remainingRowsFile } from './csvFiles';
import type { CheckResult, ImportIssue } from './types';

const BOM = String.fromCharCode(0xfeff);

const check: CheckResult = {
  status: 'problems',
  header: ['first_name', 'last_name', 'email'],
  source_rows: [
    { row: 2, raw: ['Ann', 'A', 'ann@example.com'] },
    { row: 3, raw: ['Bob', 'B', 'bob@example.com'] },
    { row: 5, raw: ['Cy', 'C', 'cy@example.com'] },
    { row: 6, raw: ['Di', 'D', 'di@example.com'] },
  ],
  problems: [
    { row: 3, column: 'email', code: 'email_invalid', params: {} },
    { row: 0, column: null, code: 'invalid_encoding', params: {} },
  ],
};

describe('buildCsv', () => {
  it('starts with a byte-order mark and ends each row with CRLF', () => {
    const csv = buildCsv(['a', 'b'], [['1', '2']]);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv).toBe(`${BOM}a,b\r\n1,2\r\n`);
  });

  it('quotes cells containing commas, semicolons, quotes and line breaks', () => {
    const csv = buildCsv(['h'], [['a,b'], ['a;b'], ['say "hi"'], ['two\nlines']]);
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"a;b"');
    expect(csv).toContain('"say ""hi"""');
    expect(csv).toContain('"two\nlines"');
  });

  it('escapes cells that a spreadsheet would run as a formula', () => {
    const csv = buildCsv(['phone', 'balance'], [['+353 1 234', '-3']]);
    expect(csv).toContain("'+353 1 234");
    expect(csv).toContain("'-3");
  });
});

describe('correctedFile', () => {
  it('drops exactly the listed rows and keeps the original header', () => {
    const csv = correctedFile(check, [3, 6]);
    expect(csv).toBe(`${BOM}first_name,last_name,email\r\nAnn,A,ann@example.com\r\nCy,C,cy@example.com\r\n`);
  });

  it('keeps everything when nothing is excluded', () => {
    expect(correctedFile(check, []).split('\r\n')).toHaveLength(6);
  });
});

describe('remainingRowsFile', () => {
  it('keeps rows from the given spreadsheet row onwards', () => {
    const csv = remainingRowsFile(check, 5);
    expect(csv).toBe(`${BOM}first_name,last_name,email\r\nCy,C,cy@example.com\r\nDi,D,di@example.com\r\n`);
  });
});

describe('problemsFile', () => {
  it('lists every problem with translated labels, including whole-file ones', () => {
    const describeIssue = (i: ImportIssue) => `problem:${i.code}`;
    const csv = problemsFile(
      check,
      { row: 'Row', column: 'Column', problem: 'Problem' },
      describeIssue,
      (c) => (c === null ? '' : `col:${c}`),
    );
    expect(csv).toBe(`${BOM}Row,Column,Problem\r\n3,col:email,problem:email_invalid\r\n0,,problem:invalid_encoding\r\n`);
  });
});

describe('fileToBase64', () => {
  it('round-trips the bytes of a file', async () => {
    const file = new File([new Uint8Array([0xef, 0xbb, 0xbf, 0x41])], 'm.csv', { type: 'text/csv' });
    const decoded = atob(await fileToBase64(file));
    expect(Array.from(decoded, (c) => c.charCodeAt(0))).toEqual([0xef, 0xbb, 0xbf, 0x41]);
  });
});
