// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import { buildCsv, correctedFile, fileToBase64, problemsFile, remainingRowsFile, rowsFromIndexFile, rowsWithNumbersFile } from './csvFiles';
import type { CheckResult, ImportIssue } from './types';

const BOM = String.fromCharCode(0xfeff);
const NBSP = String.fromCharCode(0xa0);
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

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

// A TS copy of what the server does to a cell on the way in (MemberImportRowRules::clean):
// trim, then drop one leading apostrophe only when the next character is = + - or @.
function serverClean(raw: string): string {
  const trimmed = raw.replace(/^[\s\p{Z}\p{Cf}]+|[\s\p{Z}\p{Cf}]+$/gu, '');
  return /^'[=+\-@]/.test(trimmed) ? trimmed.slice(1) : trimmed;
}

/** The single data cell buildCsv writes for a value, with CSV quoting undone. */
function writtenCell(value: string): string {
  const line = buildCsv(['h'], [[value]]).slice(BOM.length).split('\r\n')[1] as string;
  return line.startsWith('"') ? line.slice(1, -1).replace(/""/g, '"') : line;
}

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

  it('trims surrounding whitespace first, so a space before a formula character still escapes', () => {
    expect(buildCsv(['n'], [[' -3']])).toBe(`${BOM}n\r\n'-3\r\n`);
    expect(buildCsv(['p'], [[' +353 87 123 4567']])).toBe(`${BOM}p\r\n'+353 87 123 4567\r\n`);
    expect(buildCsv(['n'], [[`  Cork ${NBSP}${ZERO_WIDTH_SPACE}`]])).toBe(`${BOM}n\r\nCork\r\n`);
  });

  // The server must read the written cell exactly as it would have read the
  // original. (A cell that begins with an apostrophe before a formula character
  // cannot be told apart from our own escape, so it reads the same either way.)
  it.each(['-3', ' -3', '=x', "'=x", "''=x", '@a', 'Cork', '  +353 1 234  ', ' \t+1'])(
    'is read back as the original through the server rule: %j',
    (original) => {
      expect(serverClean(writtenCell(original))).toBe(serverClean(original));
    },
  );

  it('gives back the trimmed original for values without a leading apostrophe', () => {
    for (const original of ['-3', ' -3', '=x', "''=x", '@a', 'Cork']) {
      expect(serverClean(writtenCell(original))).toBe(original.trim());
    }
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
      (r) => (r === 0 ? 'Whole file' : String(r)),
    );
    // Row 0 means the whole file: it is written as that wording, never as a "0" an admin would hunt for.
    expect(csv).toBe(`${BOM}Row,Column,Problem\r\n3,col:email,problem:email_invalid\r\nWhole file,,problem:invalid_encoding\r\n`);
  });
});

describe('fileToBase64', () => {
  it('round-trips the bytes of a file', async () => {
    const file = new File([new Uint8Array([0xef, 0xbb, 0xbf, 0x41])], 'm.csv', { type: 'text/csv' });
    const decoded = atob(await fileToBase64(file));
    expect(Array.from(decoded, (c) => c.charCodeAt(0))).toEqual([0xef, 0xbb, 0xbf, 0x41]);
  });
});

describe('rowsFromIndexFile', () => {
  it('keeps the rows from the given position onwards, whatever their spreadsheet numbers', () => {
    expect(rowsFromIndexFile(check, 2)).toBe(`${BOM}first_name,last_name,email\r\nCy,C,cy@example.com\r\nDi,D,di@example.com\r\n`);
  });

  it('keeps everything from position 0 and nothing past the end', () => {
    expect(rowsFromIndexFile(check, 0)).toContain('Ann,A,ann@example.com');
    expect(rowsFromIndexFile(check, 4)).toBe(`${BOM}first_name,last_name,email\r\n`);
  });
});

describe('rowsWithNumbersFile', () => {
  it('lists the named rows with their spreadsheet number in front, in the order given', () => {
    expect(rowsWithNumbersFile(check, [6, 3], 'Row')).toBe(
      `${BOM}Row,first_name,last_name,email\r\n6,Di,D,di@example.com\r\n3,Bob,B,bob@example.com\r\n`,
    );
  });

  it('skips a row that is not in the file rather than inventing it', () => {
    expect(rowsWithNumbersFile(check, [99], 'Row')).toBe(`${BOM}Row,first_name,last_name,email\r\n`);
  });
});
