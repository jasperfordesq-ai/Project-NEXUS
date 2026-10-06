// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { render } from '@/test/test-utils';
import { MemberPlainText, memberPlainText } from './MemberPlainText';

/**
 * F-568 (E-093). Comment boxes and description boxes are plain text boxes, so
 * whatever a member typed into them is shown as words. Nothing in them is ever
 * interpreted as HTML — Cyphere's F-562 retest payload and every tag variant of it
 * come out as text, with no link, heading, image or table in the page.
 */
describe('MemberPlainText', () => {
  it.each([
    '<a href="https://evil.example/"><img src="https://evil.example/sign-in.png" alt="Click here to re-authenticate">https://evil.example</a>',
    '&lt;a href="https://google.com"&gt;Click here&lt;/a&gt;',
    '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
    '<svg><a href="https://evil.example">Sign in</a></svg>',
    '<a href="javascript:alert(1)">Sign in</a>',
    '<a href="https://evil.example">Sign in',
    '<!-- comment --><h1>Sign in</h1>',
    'https://google.com',
  ])('does not create active markup from stored payload %s', (content) => {
    const { container } = render(<MemberPlainText content={content} />);
    expect(container.querySelector('a, img, svg, script, iframe, form, input, h1')).toBeNull();
  });

  it("shows Cyphere's payload as words, with no link anywhere", () => {
    const { container } = render(
      <MemberPlainText content='<a href="https://google.com">Click here to re-authenticate</a>' />
    );
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('Click here to re-authenticate');
  });

  it('shows a heading, an image and a table as words only', () => {
    const { container } = render(
      <MemberPlainText content='<h1>Your session has expired</h1><img src="https://evil.example/x.png" alt="Sign in"><table><tr><td>Username</td></tr></table>' />
    );
    expect(container.querySelector('h1, img, table, a')).toBeNull();
    expect(container.textContent).toContain('Your session has expired');
    expect(container.textContent).toContain('Username');
    expect(container.textContent).not.toContain('<');
  });

  it('keeps the line breaks the member typed, in a pre-wrap element', () => {
    const { container } = render(<MemberPlainText content={'Line one\nLine two'} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.textContent).toBe('Line one\nLine two');
    expect(el.className).toContain('whitespace-pre-wrap');
  });

  it('shows literal angle brackets in ordinary prose', () => {
    const { container } = render(<MemberPlainText content="I <3 timebanking & 2 > 1" />);
    expect(container.textContent).toBe('I <3 timebanking & 2 > 1');
  });

  it('renders nothing for empty content', () => {
    const { container } = render(<MemberPlainText content="" />);
    expect(container.textContent).toBe('');
  });

  it('renders the requested tag with the given class', () => {
    const { container } = render(<MemberPlainText content="Hello" as="p" className="text-xs" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe('P');
    expect(el.className).toContain('text-xs');
    expect(el.className).toContain('whitespace-pre-wrap');
  });

  it('exposes the same conversion as a function for callers that render mentions', () => {
    expect(memberPlainText('<a href="https://google.com">Click here</a> @jane')).toBe('Click here @jane');
    expect(memberPlainText('<p>One</p><p>Two</p>')).toBe('One\n\nTwo');
  });
});
