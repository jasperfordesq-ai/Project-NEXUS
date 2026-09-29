// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSafeUrl, openSafeUrl, safeHref, webHref } from './safeHref';
import { __testing } from './sanitize';

describe('safeHref (F-298)', () => {
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' \n javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\u0000script:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
    'data:image/png;base64,AAAA',
    'file:///etc/passwd',
    'blob:https://app.example/1234',
    'intent://scan/#Intent;scheme=zxing;end',
    'ftp://example.org/file',
    '',
    '   ',
  ])('refuses %j', (value) => {
    expect(safeHref(value)).toBeUndefined();
  });

  it.each([
    ['https://meet.example.com/abc?x=1#y', 'https://meet.example.com/abc?x=1#y'],
    ['http://example.org', 'http://example.org'],
    ['  https://example.org/padded  ', 'https://example.org/padded'],
    ['mailto:someone@example.org', 'mailto:someone@example.org'],
    ['/relative/path', '/relative/path'],
    ['#section', '#section'],
    ['?q=1', '?q=1'],
  ])('keeps %j (control)', (value, expected) => {
    expect(safeHref(value)).toBe(expected);
  });

  it('treats null and undefined as no link', () => {
    expect(safeHref(null)).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });

  it('is the same rule the HTML sanitiser uses', () => {
    expect(__testing.isSafeUrl).toBe(isSafeUrl);
  });
});

describe('webHref (F-298)', () => {
  it('links only an absolute web URL, so prose is never a relative link', () => {
    expect(webHref('https://meet.example.com/x')).toBe('https://meet.example.com/x');
    expect(webHref('Room 3, second floor')).toBeUndefined();
    expect(webHref('/relative')).toBeUndefined();
    expect(webHref('mailto:a@example.org')).toBeUndefined();
    expect(webHref('javascript:alert(1)')).toBeUndefined();
  });
});

describe('openSafeUrl (F-298)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens a web URL with noopener', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openSafeUrl('https://example.org/x');
    expect(open).toHaveBeenCalledWith('https://example.org/x', '_blank', 'noopener,noreferrer');
  });

  it('does nothing for a refused URL', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openSafeUrl('javascript:alert(1)');
    openSafeUrl(null);
    expect(open).not.toHaveBeenCalled();
  });
});
