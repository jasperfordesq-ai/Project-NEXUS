// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import { faqAnswerText } from './faqText';
import { foldText, matchesEveryWord, queryWords } from './searchText';

describe('faqAnswerText', () => {
  it('returns plain answers unchanged, because SafeHtml shows them unchanged', () => {
    expect(faqAnswerText('Bring a pen & paper.')).toBe('Bring a pen & paper.');
    expect(faqAnswerText('')).toBe('');
    expect(faqAnswerText(null)).toBe('');
  });

  it('drops tags and attributes, keeping only the visible words', () => {
    // Since F-562 (E-092) SafeHtml shows a link's words as plain text followed by
    // its address, so the address is part of what a reader sees — and searches.
    const text = faqAnswerText('<p><strong>Bring</strong> your <a href="/library" class="x">card</a></p>');
    expect(text).toBe('Bring your card /library');
  });

  it('decodes entities', () => {
    expect(faqAnswerText('<p>Tea &amp; coffee &lt;free&gt;</p>')).toBe('Tea & coffee <free>');
  });

  it('keeps words in separate paragraphs, lines and list items apart', () => {
    expect(faqAnswerText('<p>One</p><p>Two</p>line<br>break<ul><li>a</li><li>b</li></ul>')).toBe('One Two line break a b');
  });

  it('never returns script or style content, and runs nothing', () => {
    const before = (window as unknown as { __faqRan?: boolean }).__faqRan;
    const text = faqAnswerText('<p>Hi</p><script>window.__faqRan = true</script><style>p{}</style><img src="x" onerror="window.__faqRan = true">');
    expect(text).toBe('Hi');
    expect((window as unknown as { __faqRan?: boolean }).__faqRan).toBe(before);
  });
});

describe('Help Centre word matching', () => {
  it('needs every word, each at the start of a word', () => {
    const text = foldText('Using a Community Pot account');
    expect(matchesEveryWord(text, queryWords('community pot'))).toBe(true);
    expect(matchesEveryWord(text, queryWords('pot spot'))).toBe(false);
    expect(matchesEveryWord(foldText('a spot of tea'), queryWords('pot'))).toBe(false);
  });

  it('ignores case, accents and punctuation', () => {
    expect(matchesEveryWord(foldText('Paiement reçu'), queryWords('PAIEMENT, recu!'))).toBe(true);
  });

  it('matches nothing when the search has no real words', () => {
    expect(queryWords('! a ?')).toEqual([]);
    expect(matchesEveryWord('anything', [])).toBe(false);
  });

  it('matches inside Japanese text, which has no spaces', () => {
    expect(matchesEveryWord(foldText('時間クレジットの送り方'), queryWords('クレジット'))).toBe(true);
  });
});
