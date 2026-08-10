// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { htmlToPlainText } = require('../src/lib/html-sanitizer');

describe('htmlToPlainText', () => {
  test('preserves readable paragraph boundaries while removing markup', () => {
    expect(htmlToPlainText('<p>Hello <strong>neighbour</strong>.</p><p>Welcome back.<br>Take care.</p>'))
      .toBe('Hello neighbour.\n\nWelcome back.\nTake care.');
  });

  test('drops non-text elements and nested tag-filter bypasses', () => {
    expect(htmlToPlainText('<scr<script>ipt>alert(1)</scr</script>ipt><p>Safe text</p>'))
      .toBe('ipt&gt;alert(1)ipt&gt;Safe text');
    expect(htmlToPlainText('<script>alert(1)</script><style>body{display:none}</style><p>Safe</p>'))
      .toBe('Safe');
  });
});
