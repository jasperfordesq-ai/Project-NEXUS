// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@/test/test-utils';

// No API calls in SafeHtml — no api mock needed.

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('SafeHtml', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns null for empty string — renders no SafeHtml element', async () => {
    const { SafeHtml } = await import('./SafeHtml');
    const { container } = render(<SafeHtml content="" />);
    // SafeHtml returns null → no tag with aria-label / data attribute from the component.
    // The toast provider shell IS in the container; verify no user-content is present.
    expect(container.textContent).toBe('');
  });

  it('renders plain text without a wrapper tag containing dangerouslySetInnerHTML', async () => {
    const { SafeHtml } = await import('./SafeHtml');
    const { container } = render(<SafeHtml content="Hello world" />);
    expect(container.textContent).toContain('Hello world');
    // No HTML should be injected — inner content is text, not markup
    expect(container.innerHTML).not.toContain('<script');
  });

  it('renders allowed block-level HTML (bold tag)', async () => {
    const { SafeHtml } = await import('./SafeHtml');
    const { container } = render(<SafeHtml content="<b>Important</b> text" />);
    const bold = container.querySelector('b');
    expect(bold).not.toBeNull();
    expect(bold?.textContent).toBe('Important');
  });

  it('renders allowed anchor tags with href', async () => {
    const { SafeHtml } = await import('./SafeHtml');
    const { container } = render(
      <SafeHtml content='<a href="https://example.com">Link</a>' />
    );
    const anchor = container.querySelector('a');
    expect(anchor).not.toBeNull();
    // F-562: member links that leave the origin show their destination.
    expect(anchor?.textContent).toBe('Link (example.com)');
  });

  it('strips <script> tags completely', async () => {
    const { SafeHtml } = await import('./SafeHtml');
    const { container } = render(
      <SafeHtml content='<script>alert("xss")</script>Safe content' />
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('<script');
    // Text content of the script body should also be stripped (KEEP_CONTENT=false for scripts)
    expect(container.textContent).not.toContain('alert(');
  });

  it('strips onerror event handler attributes', async () => {
    const { SafeHtml } = await import('./SafeHtml');
    const { container } = render(
      <SafeHtml content='<img src="x" onerror="alert(1)" />' />
    );
    const img = container.querySelector('img');
    // onerror must be removed; element may or may not be present depending on ALLOWED_TAGS
    if (img) {
      expect(img.getAttribute('onerror')).toBeNull();
    }
    // If <img> is allowed, onerror must definitely be gone
    expect(container.innerHTML).not.toContain('onerror');
  });

  it('strips javascript: href', async () => {
    const { SafeHtml } = await import('./SafeHtml');
    const { container } = render(
      <SafeHtml content='<a href="javascript:alert(1)">Click</a>' />
    );
    // DOMPurify removes the href entirely or blanks it — neither case should contain "javascript:"
    expect(container.innerHTML).not.toContain('javascript:');
    const anchor = container.querySelector('a');
    if (anchor) {
      const href = anchor.getAttribute('href') ?? '';
      expect(href).not.toContain('javascript:');
    }
  });

  it('strips onclick event handler', async () => {
    const { SafeHtml } = await import('./SafeHtml');
    const { container } = render(
      <SafeHtml content='<div onclick="evil()">text</div>' />
    );
    expect(container.innerHTML).not.toContain('onclick');
  });

  it('renders with custom className', async () => {
    const { SafeHtml } = await import('./SafeHtml');
    const { container } = render(
      <SafeHtml content="<p>Styled</p>" className="my-class" />
    );
    // The root element rendered by SafeHtml (default 'div') should carry the class
    const el = container.firstElementChild?.firstElementChild as HTMLElement | null;
    // Just confirm the class attribute appears somewhere in the subtree
    expect(container.innerHTML).toContain('my-class');
  });

  it('renders as <span> when as="span" is passed', async () => {
    const { SafeHtml } = await import('./SafeHtml');
    const { container } = render(<SafeHtml content="<b>test</b>" as="span" />);
    // The top-level SafeHtml element should be a span, not a div
    const spanEl = container.querySelector('span');
    expect(spanEl).not.toBeNull();
  });

  it('renders as <p> when as="p" is passed with plain text', async () => {
    const { SafeHtml } = await import('./SafeHtml');
    const { container } = render(<SafeHtml content="plain text" as="p" />);
    const pEl = container.querySelector('p');
    expect(pEl).not.toBeNull();
    expect(pEl?.textContent).toBe('plain text');
  });

  it('preserves safe heading tags', async () => {
    const { SafeHtml } = await import('./SafeHtml');
    const { container } = render(
      <SafeHtml content="<h2>Section Title</h2>" />
    );
    expect(container.querySelector('h2')?.textContent).toBe('Section Title');
  });

  it('preserves safe list markup', async () => {
    const { SafeHtml } = await import('./SafeHtml');
    const { container } = render(
      <SafeHtml content="<ul><li>Item 1</li><li>Item 2</li></ul>" />
    );
    const items = container.querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe('Item 1');
  });

  it('containsHtml returns true for strings with tags', async () => {
    const { containsHtml } = await import('./SafeHtml');
    expect(containsHtml('<b>hello</b>')).toBe(true);
    expect(containsHtml('<script>evil</script>')).toBe(true);
  });

  it('containsHtml returns false for plain text', async () => {
    const { containsHtml } = await import('./SafeHtml');
    expect(containsHtml('Just plain text')).toBe(false);
    expect(containsHtml('')).toBe(false);
  });
});
