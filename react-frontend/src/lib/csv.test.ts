// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv';

describe('csvCell', () => {
  it.each([
    ['=HYPERLINK("http://x","y")', `"'=HYPERLINK(""http://x"",""y"")"`],
    ['+1+1', `"'+1+1"`],
    ['-1+1', `"'-1+1"`],
    ['@SUM(1)', `"'@SUM(1)"`],
    [' =1+1', `"' =1+1"`],
    ['\t=1+1', `"'\t=1+1"`],
    ['\r=1+1', `"'\r=1+1"`],
  ])('neutralises a formula-looking value %j', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it('leaves ordinary text, numbers and empties alone (apart from quoting)', () => {
    expect(csvCell('Ada Lovelace')).toBe('"Ada Lovelace"');
    expect(csvCell('say "hi", then go')).toBe('"say ""hi"", then go"');
    expect(csvCell(-1.5)).toBe('"-1.5"');
    expect(csvCell(42)).toBe('"42"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell('a=b')).toBe('"a=b"');
  });
});

describe('toCsv', () => {
  it('builds a header row and data rows with CRLF line endings', () => {
    expect(toCsv(['Name', 'Note'], [['Ada', '=1+1'], ['Bob', 'fine']])).toBe(
      `"Name","Note"\r\n"Ada","'=1+1"\r\n"Bob","fine"`,
    );
  });
});

describe("csvCell — Cyphere's exact wallet payload (F-561, 4 Oct 2026)", () => {
  it("neutralises =cmd|'/C calc'!A0 as it appears in a transfer description", () => {
    expect(csvCell("=cmd|'/C calc'!A0")).toBe(`"'=cmd|'/C calc'!A0"`);
  });
});
