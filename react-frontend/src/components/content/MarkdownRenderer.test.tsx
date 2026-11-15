// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── API mock (not used but kept per pattern) ──────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), download: vi.fn(), upload: vi.fn() },
}));
vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));

// ─── Contexts ─────────────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: null, isAuthenticated: false, isLoading: false, status: 'idle' as const,
      login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), error: null,
    }),
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
    useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() }),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
describe('MarkdownRenderer', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders without crashing on empty string', async () => {
    const { MarkdownRenderer } = await import('./MarkdownRenderer');
    const { container } = render(<MarkdownRenderer content="" />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders plain paragraph text', async () => {
    const { MarkdownRenderer } = await import('./MarkdownRenderer');
    render(<MarkdownRenderer content="Hello world" />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders an h1 heading from # markdown', async () => {
    const { MarkdownRenderer } = await import('./MarkdownRenderer');
    const { container } = render(<MarkdownRenderer content="# Main Title" />);
    const h1 = container.querySelector('h1');
    expect(h1).toBeTruthy();
    expect(h1?.textContent).toBe('Main Title');
  });

  it('renders an h2 heading from ## markdown', async () => {
    const { MarkdownRenderer } = await import('./MarkdownRenderer');
    const { container } = render(<MarkdownRenderer content="## Section Title" />);
    const h2 = container.querySelector('h2');
    expect(h2).toBeTruthy();
    expect(h2?.textContent).toBe('Section Title');
  });

  it('renders h3 headings from ### markdown', async () => {
    const { MarkdownRenderer } = await import('./MarkdownRenderer');
    const { container } = render(<MarkdownRenderer content="### Sub-section" />);
    const h3 = container.querySelector('h3');
    expect(h3).toBeTruthy();
    expect(h3?.textContent).toBe('Sub-section');
  });

  it('renders an unordered list from - items', async () => {
    const { MarkdownRenderer } = await import('./MarkdownRenderer');
    const { container } = render(<MarkdownRenderer content={'- Apple\n- Banana\n- Cherry'} />);
    const items = container.querySelectorAll('li');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toBe('Apple');
    expect(items[2].textContent).toBe('Cherry');
  });

  it('renders an ordered list from numbered items', async () => {
    const { MarkdownRenderer } = await import('./MarkdownRenderer');
    const { container } = render(<MarkdownRenderer content={'1. First\n2. Second\n3. Third'} />);
    const ol = container.querySelector('ol');
    expect(ol).toBeTruthy();
    const items = ol!.querySelectorAll('li');
    expect(items).toHaveLength(3);
  });

  it('renders bold text from **bold**', async () => {
    const { MarkdownRenderer } = await import('./MarkdownRenderer');
    const { container } = render(<MarkdownRenderer content="This is **bold** text" />);
    const strong = container.querySelector('strong');
    expect(strong).toBeTruthy();
    expect(strong?.textContent).toBe('bold');
  });

  it('renders an anchor tag for markdown links', async () => {
    const { MarkdownRenderer } = await import('./MarkdownRenderer');
    const { container } = render(<MarkdownRenderer content="[Click here](https://example.com)" />);
    const link = container.querySelector('a');
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toBe('https://example.com');
    expect(link?.textContent).toBe('Click here');
  });

  it('adds target="_blank" and rel="noopener noreferrer" to external https links', async () => {
    const { MarkdownRenderer } = await import('./MarkdownRenderer');
    const { container } = render(<MarkdownRenderer content="[External](https://example.com)" />);
    const link = container.querySelector('a');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('adds target="_blank" and rel="noopener noreferrer" to external http links', async () => {
    const { MarkdownRenderer } = await import('./MarkdownRenderer');
    const { container } = render(<MarkdownRenderer content="[Old HTTP](http://example.com)" />);
    const link = container.querySelector('a');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('does NOT add target="_blank" to relative/internal links', async () => {
    const { MarkdownRenderer } = await import('./MarkdownRenderer');
    const { container } = render(<MarkdownRenderer content="[Internal](/about)" />);
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/about');
    expect(link?.getAttribute('target')).not.toBe('_blank');
  });

  it('applies extra className when provided', async () => {
    const { MarkdownRenderer } = await import('./MarkdownRenderer');
    const { container } = render(<MarkdownRenderer content="text" className="custom-class" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('custom-class');
  });

  it('applies the changelog presentation variant', async () => {
    const { MarkdownRenderer } = await import('./MarkdownRenderer');
    const { container } = render(
      <MarkdownRenderer
        content={'# Changelog\n\n## [1.5.4] - 2026-06-29\n\n### Fixed\n\n- **Cleaner release notes.**'}
        variant="changelog"
      />
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('changelog-markdown');
    expect(wrapper.className).toContain('[&_h2]:scroll-mt-24');
    expect(wrapper.className).toContain('[&_li]:rounded-md');
  });

  it('applies the compact presentation for the detail of one changelog entry', async () => {
    const { MarkdownRenderer } = await import('./MarkdownRenderer');
    const { container } = render(
      <MarkdownRenderer content={'The detail, with `code.ts`.\n\n- a nested point'} variant="changelogEntry" />
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('changelog-entry-markdown');
    // A bullet here is a point inside one change, not a change of its own:
    // it must not get the card look the whole-file variant gives each bullet.
    expect(wrapper.className).toContain('[&_ul]:list-disc');
    expect(wrapper.className).not.toContain('[&_li]:rounded-md');
  });

  it('applies the knowledge base article presentation variant', async () => {
    const { MarkdownRenderer } = await import('./MarkdownRenderer');
    const { container } = render(
      <MarkdownRenderer
        content={'# Article\n\n## Setup\n\n- First step\n\n| Key | Value |\n| --- | --- |\n| API | Ready |'}
        variant="knowledgeBase"
      />
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('kb-markdown');
    expect(wrapper.className).toContain('[&_h2]:scroll-mt-24');
    expect(wrapper.className).toContain('[&_table]:min-w-full');
    expect(wrapper.className).toContain('[&_li]:pl-1');
  });

  it('renders GFM strikethrough via remark-gfm', async () => {
    const { MarkdownRenderer } = await import('./MarkdownRenderer');
    const { container } = render(<MarkdownRenderer content="~~deleted~~" />);
    const del = container.querySelector('del') ?? container.querySelector('s');
    expect(del).toBeTruthy();
  });

  it('renders multiple paragraphs as separate <p> elements', async () => {
    const { MarkdownRenderer } = await import('./MarkdownRenderer');
    const { container } = render(<MarkdownRenderer content={'First paragraph.\n\nSecond paragraph.'} />);
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs.length).toBeGreaterThanOrEqual(2);
  });
});
