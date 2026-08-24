// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { looksLikeHtml, toPlainText } from './plainText';

/**
 * 🔴 The first case is the member's own post, copied from the screenshot she sent on
 * 2026-08-24. Everything else here exists because of what that markup contains.
 */
describe('toPlainText', () => {
  const REPORTED_POST =
    '<p class="mb-1 leading-relaxed text-[var(--text-primary)]"><span>So I had meeting booked in '
    + 'this morning for 10am to chat with a Time Bank member about what they need.</span></p>';

  it('shows the reported post as words, with no markup left', () => {
    expect(toPlainText(REPORTED_POST)).toBe(
      'So I had meeting booked in this morning for 10am to chat with a Time Bank member about what they need.',
    );
    expect(toPlainText(REPORTED_POST)).not.toContain('<');
    expect(toPlainText(REPORTED_POST)).not.toContain('class=');
  });

  it('keeps paragraphs apart instead of running them together', () => {
    // A reader notices this; collapsing it into one block is why the six older copies of
    // this helper produce a wall of text.
    expect(toPlainText('<p>First thing.</p><p>Second thing.</p>')).toBe('First thing.\n\nSecond thing.');
  });

  it('keeps line breaks and list items', () => {
    expect(toPlainText('One<br>Two')).toBe('One\nTwo');
    expect(toPlainText('<ul><li>Bread</li><li>Milk</li></ul>')).toBe('• Bread\n\n• Milk');
  });

  it('turns entities back into the characters they stand for', () => {
    expect(toPlainText('Tea &amp; coffee')).toBe('Tea & coffee');
    expect(toPlainText('It&#39;s fine')).toBe("It's fine");
    expect(toPlainText('&ldquo;quoted&rdquo;')).toBe('“quoted”');
    expect(toPlainText('a&nbsp;b')).toBe('a b');
  });

  it('never shows script or style content as if it were the post', () => {
    expect(toPlainText('<style>.x{color:red}</style>Hello')).toBe('Hello');
    expect(toPlainText('<script>alert(1)</script>Hello')).toBe('Hello');
  });

  it('leaves plain text exactly as it was', () => {
    // Most posts are typed in the app and contain no markup at all: this must be a no-op
    // for them, punctuation included.
    const typed = 'Can anyone help me move a wardrobe on Saturday? 3 < 5 and I can offer tea.';
    expect(toPlainText(typed)).toBe(typed);
  });

  it('handles nothing gracefully', () => {
    expect(toPlainText(null)).toBe('');
    expect(toPlainText(undefined)).toBe('');
    expect(toPlainText('   ')).toBe('');
  });

  it('recognises stored html', () => {
    expect(looksLikeHtml(REPORTED_POST)).toBe(true);
    expect(looksLikeHtml('just words')).toBe(false);
  });
});
