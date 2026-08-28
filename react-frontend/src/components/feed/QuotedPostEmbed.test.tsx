// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

// Stub helpers to return predictable values
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (url: string | null | undefined) => url ?? '',
  resolveAssetUrl: (url: string | null | undefined) => url ?? '',
  resolveThumbnailUrl: (url: string | null | undefined) => url ?? '',
  formatRelativeTime: () => '5m ago',
}));

import { QuotedPostEmbed } from './QuotedPostEmbed';
import type { QuotedPostData } from './QuotedPostEmbed';

const SHORT_POST: QuotedPostData = {
  id: 1,
  content: 'Short content',
  created_at: '2026-01-01T00:00:00Z',
  author: { id: 10, name: 'Bob', avatar_url: null },
};

const LONG_POST: QuotedPostData = {
  id: 2,
  content: 'x'.repeat(300),
  created_at: '2026-01-01T00:00:00Z',
  author: { id: 11, name: 'Carol', avatar_url: 'https://example.com/carol.jpg' },
};

const POST_WITH_IMAGE: QuotedPostData = {
  id: 3,
  content: 'Post with image',
  image_url: 'https://example.com/img.jpg',
  created_at: '2026-01-01T00:00:00Z',
  author: { id: 12, name: 'Dave', avatar_url: null },
};

const POST_WITH_MEDIA: QuotedPostData = {
  id: 4,
  content: 'Post with media',
  created_at: '2026-01-01T00:00:00Z',
  author: { id: 13, name: 'Eve', avatar_url: null },
  media: [
    {
      id: 100,
      media_type: 'image',
      file_url: 'https://example.com/media.jpg',
      thumbnail_url: 'https://example.com/thumb.jpg',
      alt_text: 'A media image',
    },
  ],
};

describe('QuotedPostEmbed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the author name', () => {
    render(<QuotedPostEmbed post={SHORT_POST} />);
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('renders the post content', () => {
    render(<QuotedPostEmbed post={SHORT_POST} />);
    expect(screen.getByText('Short content')).toBeInTheDocument();
  });

  it('renders the relative time', () => {
    render(<QuotedPostEmbed post={SHORT_POST} />);
    expect(screen.getByText('5m ago')).toBeInTheDocument();
  });

  it('wraps content in a link when not in preview mode', () => {
    const { container } = render(<QuotedPostEmbed post={SHORT_POST} isPreview={false} />);
    const link = container.querySelector('a');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/test/feed?post=1');
  });

  it('does NOT render a link wrapper in preview mode', () => {
    const { container } = render(<QuotedPostEmbed post={SHORT_POST} isPreview={true} />);
    expect(container.querySelector('a')).not.toBeInTheDocument();
  });

  it('truncates long content and shows "Read more" button', () => {
    render(<QuotedPostEmbed post={LONG_POST} />);
    expect(screen.getByRole('button', { name: /read more/i })).toBeInTheDocument();
    // Content should be sliced at 280 chars
    expect(screen.queryByText(LONG_POST.content)).not.toBeInTheDocument();
  });

  it('expands content after pressing "Read more"', async () => {
    render(<QuotedPostEmbed post={LONG_POST} />);
    fireEvent.click(screen.getByRole('button', { name: /read more/i }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /read more/i })).not.toBeInTheDocument();
      // Full content should now be visible
      expect(screen.getByText(LONG_POST.content)).toBeInTheDocument();
    });
  });

  it('renders the post image from image_url', () => {
    render(<QuotedPostEmbed post={POST_WITH_IMAGE} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/img.jpg');
  });

  it('renders thumbnail from media array when available', () => {
    render(<QuotedPostEmbed post={POST_WITH_MEDIA} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/thumb.jpg');
  });

  it('does not render an image when there is no image_url or media', () => {
    render(<QuotedPostEmbed post={SHORT_POST} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('does not show "Read more" for short content', () => {
    render(<QuotedPostEmbed post={SHORT_POST} />);
    expect(screen.queryByRole('button', { name: /read more/i })).not.toBeInTheDocument();
  });

  it('renders content_truncated=true posts with "Read more"', () => {
    const truncatedPost: QuotedPostData = {
      ...SHORT_POST,
      content_truncated: true,
    };
    render(<QuotedPostEmbed post={truncatedPost} />);
    // shouldTruncate=true because content_truncated flag is set
    expect(screen.getByRole('button', { name: /read more/i })).toBeInTheDocument();
  });
});

/**
 * 🔴 Quoting a post written on the website showed its markup, not its words.
 *
 * A quoted post IS a feed post, so its content is whatever the web composer stored — HTML.
 * This card dropped that string into a `<p>` as text, so the reader saw
 * `<p class="mb-1 leading-relaxed text-[var(--text-primary)]"><span>…`. It is the same fault
 * a member reported on the phone on 2026-08-24; the phone was fixed that day and the website
 * was not, because the main feed renders through `FeedContentRenderer` and this card does not.
 *
 * Found 2026-08-28 while answering "do we have the same problem on desktop?".
 *
 * 🔴 Every assertion here was checked against the OLD code first. Four earlier drafts of this
 * block passed with the fix reverted — `getByText(/substring/)` still matches when the whole
 * raw tag soup is on screen, and a fixture whose markup does not actually cross 280 cannot
 * show the counting bug. A test that cannot fail is not evidence.
 */
describe('QuotedPostEmbed — content written in the web composer', () => {
  const OPEN = '<p class="mb-1 leading-relaxed text-[var(--text-primary)]"><span>';
  const CLOSE = '</span></p>';

  const SENTENCE = 'So I had a meeting booked in this morning for 10am.';

  const HTML_POST: QuotedPostData = {
    id: 5,
    content: `${OPEN}${SENTENCE}${CLOSE}`,
    created_at: '2026-01-01T00:00:00Z',
    author: { id: 14, name: 'Alan', avatar_url: null },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the sentence as the whole of the paragraph, not buried in tag soup', () => {
    render(<QuotedPostEmbed post={HTML_POST} />);

    // An exact-text lookup is the point: a substring regex matches even when the markup is
    // still on screen around it, which is how this fault survived unnoticed.
    expect(screen.getByText(SENTENCE)).toBeInTheDocument();
  });

  it('never puts a tag or a class name on screen', () => {
    const { container } = render(<QuotedPostEmbed post={HTML_POST} />);
    const shown = container.textContent ?? '';

    expect(shown).not.toContain('<p');
    expect(shown).not.toContain('<span');
    expect(shown).not.toContain('class=');
    expect(shown).not.toContain('leading-relaxed');
    expect(shown).not.toContain('--text-primary');
  });

  it('measures the words, not the markup, when deciding to truncate', () => {
    // Three composer paragraphs: ~75 characters of markup each, so the RAW string clears 280
    // while the words a reader sees are nowhere near it. This is the "Read more" on a short
    // post that started the whole investigation.
    const content =
      `${OPEN}Short enough to read at a glance.${CLOSE}` +
      `${OPEN}And a second short line.${CLOSE}` +
      `${OPEN}And a third.${CLOSE}`;

    expect(content.length).toBeGreaterThan(280); // the raw string is over the limit…
    expect(content.replace(/<[^>]*>/g, '').length).toBeLessThan(280); // …the words are not

    render(<QuotedPostEmbed post={{ ...HTML_POST, id: 6, content }} />);

    expect(screen.queryByRole('button', { name: /read more/i })).not.toBeInTheDocument();
  });

  it('still truncates when the VISIBLE text is genuinely long', () => {
    // Guards the other direction: the fix must not make long posts un-truncatable.
    const content = `<p>${'word '.repeat(100)}</p>`;
    expect(content.replace(/<[^>]*>/g, '').length).toBeGreaterThan(280);

    render(<QuotedPostEmbed post={{ ...HTML_POST, id: 7, content }} />);

    expect(screen.getByRole('button', { name: /read more/i })).toBeInTheDocument();
  });
});
