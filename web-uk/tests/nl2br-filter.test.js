// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The nl2br Nunjucks filter renders member-supplied text with line breaks. Its
 * output is emitted with `| safe`, so it is the sole XSS defence for that
 * content. It MUST escape HTML before turning newlines into <br>, and must
 * never leave a user-typed tag live.
 */

const { nl2br } = require('../src/lib/nl2br');

describe('nl2br filter', () => {
  it('returns an empty string for falsy input', () => {
    expect(nl2br('')).toBe('');
    expect(nl2br(null)).toBe('');
    expect(nl2br(undefined)).toBe('');
  });

  it('converts newlines to <br>', () => {
    expect(nl2br('one\ntwo\nthree')).toBe('one<br>two<br>three');
  });

  it('escapes HTML so a user-typed tag cannot execute', () => {
    const out = nl2br('<script>alert(1)</script>');
    expect(out).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).not.toContain('<script>');
  });

  it('escapes a literal <br> typed by the user rather than honouring it', () => {
    const out = nl2br('line<br>still same line');
    expect(out).toContain('&lt;br&gt;');
    // The only real <br> tags come from actual newline characters — none here.
    expect(out).not.toMatch(/<br>/);
  });

  it('escapes ampersands, quotes and angle brackets, then breaks lines', () => {
    const out = nl2br('a & b "c" \'d\' <e>\nnext');
    expect(out).toBe('a &amp; b &quot;c&quot; &#039;d&#039; &lt;e&gt;<br>next');
  });

  it('escapes before inserting <br> (ampersand in content is not double-escaped away)', () => {
    // If <br> were inserted first and escaping ran afterwards, our own <br>
    // would become &lt;br&gt;. Prove the real break survives while content &
    // is escaped exactly once.
    const out = nl2br('Tom & Jerry\nEND');
    expect(out).toBe('Tom &amp; Jerry<br>END');
  });
});
