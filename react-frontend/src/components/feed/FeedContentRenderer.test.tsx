// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for FeedContentRenderer component
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';

const mockTenantPath = vi.fn((p: string) => `/test${p}`);

vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: mockTenantPath,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null }),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

import { FeedContentRenderer } from './FeedContentRenderer';

describe('FeedContentRenderer', () => {
  it('returns null for empty content', () => {
    const { container } = render(<FeedContentRenderer content="" />);
    // Component returns null, but the wrapper providers still render their containers
    // so we check that no meaningful feed content is rendered
    expect(container.querySelector('p')).not.toBeInTheDocument();
    expect(container.querySelector('.feed-content')).not.toBeInTheDocument();
  });

  it('renders plain text content', () => {
    render(<FeedContentRenderer content="Hello world" />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders plain text in a paragraph with whitespace-pre-wrap', () => {
    render(<FeedContentRenderer content="Line one" />);
    const el = screen.getByText('Line one');
    expect(el.tagName).toBe('P');
    expect(el.className).toContain('whitespace-pre-wrap');
  });

  it('renders HTML content safely via dangerouslySetInnerHTML', () => {
    render(<FeedContentRenderer content="<p>Rich <strong>content</strong></p>" />);
    expect(screen.getByText('content')).toBeInTheDocument();
    // The strong tag should be present
    const strong = screen.getByText('content');
    expect(strong.tagName).toBe('STRONG');
  });

  it('strips disallowed HTML tags', () => {
    render(
      <FeedContentRenderer content='<p>safe</p><script>alert("xss")</script>' />
    );
    expect(screen.getByText('safe')).toBeInTheDocument();
    // Script content should not appear in the DOM
    expect(screen.queryByText('alert("xss")')).not.toBeInTheDocument();
  });


  // F-569 (E-093): a feed post shows only what the feed composer can make. A heading,
  // an image from another site, a table or a quote sent straight to the API renders as
  // words only, and an injected link's words are never the clickable part.
  it('shows injected headings, images and tables in a post as words only', () => {
    const { container } = render(
      <FeedContentRenderer content='<h1>Your session has expired</h1><img src="https://evil.example/login.png" alt="Sign in"><table><tr><td>Username</td></tr></table><blockquote>Note</blockquote><p><a href="https://google.com">Click here to re-authenticate</a></p>' />
    );
    const feed = container.querySelector('.feed-content') as HTMLElement;
    expect(feed.querySelector('h1, h2, h3, img, table, blockquote')).toBeNull();
    expect(feed.textContent).toContain('Your session has expired');
    expect(feed.textContent).toContain('Username');
    const links = Array.from(feed.querySelectorAll('a')).map((a) => a.textContent?.trim());
    expect(links).toEqual(['https://google.com']);
  });

  it('keeps the formatting the feed composer makes', () => {
    const { container } = render(
      <FeedContentRenderer content='<p><strong>Bold</strong> <em>it</em> <u>u</u> <s>s</s></p><ul><li>One</li></ul><ol><li>Two</li></ol>' />
    );
    const feed = container.querySelector('.feed-content') as HTMLElement;
    // strong, em, u, s, ul, ol and two li
    expect(feed.querySelectorAll('strong, em, u, s, ul, ol, li').length).toBe(8);
  });
  it('renders "read more" link when truncated with detailPath', () => {
    render(
      <FeedContentRenderer
        content="Some text"
        truncated={true}
        detailPath="/test/feed/1"
      />
    );
    expect(screen.getByRole('link', { name: /read more/i })).toBeInTheDocument();
  });

  it('does not render "read more" when not truncated', () => {
    render(
      <FeedContentRenderer
        content="Some text"
        truncated={false}
        detailPath="/test/feed/1"
      />
    );
    expect(screen.queryByText('read more')).not.toBeInTheDocument();
  });

  it('does not render "read more" when truncated but no detailPath', () => {
    render(
      <FeedContentRenderer
        content="Some text"
        truncated={true}
      />
    );
    expect(screen.queryByText('read more')).not.toBeInTheDocument();
  });

  it('renders hashtags as clickable links in plain text', () => {
    render(<FeedContentRenderer content="Check out #React today" />);
    const hashtagLink = screen.getByText('#React');
    expect(hashtagLink.tagName).toBe('A');
    expect(hashtagLink).toHaveAttribute('href', '/test/feed/hashtag/React');
  });

  it('renders "read more" for HTML content when truncated', () => {
    render(
      <FeedContentRenderer
        content="<p>HTML content here</p>"
        truncated={true}
        detailPath="/test/feed/2"
      />
    );
    // The HTML "read more" link has a "..." prefix text node and translation text
    const link = screen.getByRole('link', { name: /read more/i });
    expect(link).toBeInTheDocument();
  });
});
