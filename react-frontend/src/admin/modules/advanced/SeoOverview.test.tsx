// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// The sharing-image field uploads through the API client directly.
const { mockApiUpload } = vi.hoisted(() => ({ mockApiUpload: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: { upload: mockApiUpload },
}));

// ─── Mock adminApi ────────────────────────────────────────────────────────────
const { mockAdminSettings, mockAdminTools } = vi.hoisted(() => ({
  mockAdminSettings: {
    getSeoSettings: vi.fn(),
    updateSeoSettings: vi.fn(),
    getSitemapStats: vi.fn(),
    clearSitemapCache: vi.fn(),
  },
  mockAdminTools: {
    getSeoAudit: vi.fn(),
    runSeoAudit: vi.fn(),
  },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminSettings: mockAdminSettings,
  adminTools: mockAdminTools,
}));

// ─── Contexts ─────────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Stub AdminMetaContext ─────────────────────────────────────────────────────
vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
  AdminMetaProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../components', () => ({
  PageHeader: ({ title }: { title: string }) => <div data-testid="page-header">{title}</div>,
}));

vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Stub HeroUI Switch to avoid infinite loop in jsdom ───────────────────────
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    Switch: ({ isSelected, onValueChange, 'aria-label': label }: {
      isSelected: boolean;
      onValueChange?: (v: boolean) => void;
      'aria-label'?: string;
    }) => (
      <input
        type="checkbox"
        aria-label={label}
        checked={isSelected}
        onChange={(e) => onValueChange?.(e.target.checked)}
        data-testid="switch"
      />
    ),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeSeoData = (overrides: Record<string, unknown> = {}) => ({
  data: {
    seo: {
      seo_title_suffix: ' | My Timebank',
      seo_meta_description: 'A great community for exchanging time and skills in your local area.',
      seo_meta_keywords: 'timebank',
      seo_og_image_url: '',
      seo_auto_sitemap: true,
      seo_canonical_urls: true,
      seo_open_graph: true,
      seo_twitter_cards: true,
      seo_robots_txt: '',
      seo_google_verification: 'google-abc123',
      seo_bing_verification: '',
      tenant_meta_title: 'My Timebank',
      tenant_meta_description: 'A community platform',
      tenant_h1_headline: 'Welcome to My Timebank',
      tenant_hero_intro: 'Exchange time with your neighbours',
      ...overrides,
    },
  },
  success: true,
});

// The keys SitemapService::getStats() really returns (2026-10-23).
const makeSitemapStats = (overrides: Record<string, unknown> = {}) => ({
  data: {
    sitemap_url: 'https://example.com/sitemap.xml',
    total_urls: 42,
    content_types: { static_pages: 8, cms_pages: 4, blog_posts: 20, public_events: 10 },
    ...overrides,
  },
  success: true,
});

const waitForLoad = async () => {
  await waitFor(() => {
    const busy = screen.queryAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeUndefined();
  });
};

const makeAuditResult = () => ({
  data: {
    checks: [{
      code: 'redirect_health',
      params: { count: 2 },
      status: 'warning',
      issues: [{
        code: 'redirect_chain',
        params: { from: '/old', via: '/middle', destination: '/new' },
      }],
      issue_count: 1,
      points: 5,
      max_points: 10,
    }],
    score: 5,
    max_score: 10,
    grade: 'F',
    run_at: '2026-01-01T00:00:00Z',
  },
  success: true,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SeoOverview', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminSettings.getSeoSettings.mockResolvedValue(makeSeoData());
    mockAdminSettings.updateSeoSettings.mockResolvedValue({ success: true });
    mockAdminSettings.getSitemapStats.mockResolvedValue(makeSitemapStats());
    mockAdminSettings.clearSitemapCache.mockResolvedValue({ success: true });
    mockAdminTools.getSeoAudit.mockResolvedValue({ data: null, success: false });
    mockAdminTools.runSeoAudit.mockResolvedValue(makeAuditResult());
  });

  it('shows loading spinner initially then renders content', async () => {
    mockAdminSettings.getSeoSettings.mockImplementationOnce(() => new Promise(() => {}));
    const { SeoOverview } = await import('./SeoOverview');
    render(<SeoOverview />);

    const statusEls = screen.getAllByRole('status');
    const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders health check section after load', async () => {
    const { SeoOverview } = await import('./SeoOverview');
    render(<SeoOverview />);

    await waitFor(() => {
      // Spinner gone
      const statusEls = screen.queryAllByRole('status');
      const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });

    // Health checks are rendered (they exist as divs with check names)
    expect(screen.getByText(/pass/i)).toBeInTheDocument();
  });

  it('renders sitemap URL when stats load', async () => {
    const { SeoOverview } = await import('./SeoOverview');
    render(<SeoOverview />);

    await waitFor(() => {
      expect(screen.getByText('https://example.com/sitemap.xml')).toBeInTheDocument();
    });
  });

  it('renders sitemap total_urls count', async () => {
    const { SeoOverview } = await import('./SeoOverview');
    render(<SeoOverview />);

    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument();
    });
  });

  it('calls updateSeoSettings when save button clicked', async () => {
    const { SeoOverview } = await import('./SeoOverview');
    render(<SeoOverview />);

    await waitFor(() => {
      const statusEls = screen.queryAllByRole('status');
      const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });

    const saveBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('save')
    );
    expect(saveBtn).toBeDefined();
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockAdminSettings.updateSeoSettings).toHaveBeenCalled();
    });
  });

  it('shows and saves tagline, search engine visibility and organisation type, as the super-admin form does', async () => {
    mockAdminSettings.getSeoSettings.mockResolvedValue(makeSeoData({
      tenant_tagline: 'Neighbours sharing skills',
      tenant_robots_directive: 'noindex, follow',
      tenant_seo_organization_type: 'CommunityOrganization',
    }));
    const { SeoOverview } = await import('./SeoOverview');
    render(<SeoOverview />);

    const tagline = await screen.findByLabelText('Tagline');
    expect(tagline).toHaveValue('Neighbours sharing skills');
    expect(tagline).toHaveAttribute('maxLength', '255');
    expect(screen.getAllByText('Hide from search results, but follow links').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Community organisation').length).toBeGreaterThan(0);

    fireEvent.change(tagline, { target: { value: 'One hour at a time' } });
    const saveBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('save'));
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => expect(mockAdminSettings.updateSeoSettings).toHaveBeenCalledWith(expect.objectContaining({
      tenant_tagline: 'One hour at a time',
      tenant_robots_directive: 'noindex, follow',
      tenant_seo_organization_type: 'CommunityOrganization',
    })));
  });

  // seo_primary_site (2026-10-23): which of the two sites search engines list.
  describe('site for search engines', () => {
    const save = () => {
      const saveBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('save'));
      fireEvent.click(saveBtn!);
    };

    it('defaults to the standard site, explains both choices, and saves "standard"', async () => {
      const { SeoOverview } = await import('./SeoOverview');
      render(<SeoOverview />);
      await waitForLoad();
      expect(screen.getAllByText('Site for search engines').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Standard site (recommended)').length).toBeGreaterThan(0);
      expect(screen.getByText(/search engines list the accessible site instead/)).toBeInTheDocument();
      expect(screen.getByText(/Only choose the accessible site if your community promotes it as its main site/))
        .toBeInTheDocument();
      save();
      await waitFor(() => expect(mockAdminSettings.updateSeoSettings).toHaveBeenCalledWith(
        expect.objectContaining({ seo_primary_site: 'standard' }),
      ));
    });

    it('shows a saved "accessible" choice and keeps it on save', async () => {
      mockAdminSettings.getSeoSettings.mockResolvedValue(makeSeoData({ seo_primary_site: 'accessible' }));
      const { SeoOverview } = await import('./SeoOverview');
      render(<SeoOverview />);
      await waitForLoad();
      const trigger = await screen.findByRole('button', { name: /Site for search engines/ });
      expect(trigger).toHaveTextContent('Accessible site');
      save();
      await waitFor(() => expect(mockAdminSettings.updateSeoSettings).toHaveBeenCalledWith(
        expect.objectContaining({ seo_primary_site: 'accessible' }),
      ));
    });

    it('lets the admin switch to the accessible site', async () => {
      const user = userEvent.setup();
      const { SeoOverview } = await import('./SeoOverview');
      render(<SeoOverview />);
      await waitForLoad();
      await user.click(await screen.findByRole('button', { name: /Site for search engines/ }));
      await user.click(await screen.findByRole('option', { name: 'Accessible site' }));
      save();
      await waitFor(() => expect(mockAdminSettings.updateSeoSettings).toHaveBeenCalledWith(
        expect.objectContaining({ seo_primary_site: 'accessible' }),
      ));
    });
  });

  it('shows success toast after save', async () => {
    const { SeoOverview } = await import('./SeoOverview');
    render(<SeoOverview />);

    await waitFor(() => {
      const statusEls = screen.queryAllByRole('status');
      const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });

    const saveBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows error toast when load fails', async () => {
    mockAdminSettings.getSeoSettings.mockRejectedValue(new Error('Network failure'));
    const { SeoOverview } = await import('./SeoOverview');
    render(<SeoOverview />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('calls clearSitemapCache and refreshes stats when clear cache pressed', async () => {
    const { SeoOverview } = await import('./SeoOverview');
    render(<SeoOverview />);

    await waitFor(() => screen.getByText('https://example.com/sitemap.xml'));

    const clearBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('clear') || b.textContent?.toLowerCase().includes('cache')
    );
    expect(clearBtn).toBeDefined();
    if (clearBtn) fireEvent.click(clearBtn);

    await waitFor(() => {
      expect(mockAdminSettings.clearSitemapCache).toHaveBeenCalled();
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows run audit button and calls audit endpoints', async () => {
    mockAdminTools.getSeoAudit.mockResolvedValue(makeAuditResult());

    const { SeoOverview } = await import('./SeoOverview');
    render(<SeoOverview />);

    await waitFor(() => {
      const statusEls = screen.queryAllByRole('status');
      const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });

    const auditBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('audit') || b.textContent?.toLowerCase().includes('run')
    );
    expect(auditBtn).toBeDefined();
    if (auditBtn) fireEvent.click(auditBtn);

    await waitFor(() => {
      expect(mockAdminTools.runSeoAudit).toHaveBeenCalled();
    });

    expect(screen.getByText('Redirect Health')).toBeInTheDocument();
    expect(screen.getByText('Redirect chain: /old → /middle → /new')).toBeInTheDocument();
  });

  it('labels every content type the sitemap really reports', async () => {
    const { SeoOverview } = await import('./SeoOverview');
    render(<SeoOverview />);

    await waitFor(() => {
      expect(screen.getByText('Standard pages')).toBeInTheDocument();
      expect(screen.getByText('Custom pages')).toBeInTheDocument();
      expect(screen.getByText('Blog posts')).toBeInTheDocument();
      expect(screen.getByText('Public events')).toBeInTheDocument();
    });
    expect(screen.queryByText('Other content')).not.toBeInTheDocument();
  });

  it('says the sitemap URLs are listed, not indexed', async () => {
    const { SeoOverview } = await import('./SeoOverview');
    render(<SeoOverview />);
    await waitFor(() => expect(screen.getByText('Active — 42 URLs listed')).toBeInTheDocument());
    expect(screen.queryByText(/indexed/)).not.toBeInTheDocument();
  });

  it('treats a response without the listed flag (older server) as listed', async () => {
    const { SeoOverview } = await import('./SeoOverview');
    render(<SeoOverview />);
    await waitFor(() => screen.getByText('https://example.com/sitemap.xml'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('warns that search engines get no sitemap when the community is hidden from search', async () => {
    mockAdminSettings.getSitemapStats.mockResolvedValue(makeSitemapStats({ listed: false, not_listed_reason: 'noindex' }));
    const { SeoOverview } = await import('./SeoOverview');
    render(<SeoOverview />);

    const text = 'Search engines get no sitemap for this community: it is set to be hidden from search results.';
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(text);
    // And the health check reports it instead of "Active".
    const checks = screen.getAllByText(text);
    expect(checks.length).toBe(2);
    expect(checks.some((el) => el.closest('[data-testid="health-check-warning"]'))).toBe(true);
    expect(screen.queryByText(/URLs listed/)).not.toBeInTheDocument();
  });

  it('fails the sitemap health check when the automatic sitemap switch is off on the server', async () => {
    mockAdminSettings.getSitemapStats.mockResolvedValue(makeSitemapStats({ listed: false, not_listed_reason: 'switched_off' }));
    const { SeoOverview } = await import('./SeoOverview');
    render(<SeoOverview />);

    const text = 'Search engines get no sitemap for this community: the automatic sitemap switch is off.';
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(text);
    expect(screen.getAllByText(text).some((el) => el.closest('[data-testid="health-check-fail"]'))).toBe(true);
  });

  it('counts meta title and description against the real limits and what results show', async () => {
    mockAdminSettings.getSeoSettings.mockResolvedValue(makeSeoData({
      tenant_meta_title: 'My Timebank',
      tenant_meta_description: 'A community platform',
    }));
    const { SeoOverview } = await import('./SeoOverview');
    render(<SeoOverview />);
    await waitForLoad();

    expect(screen.getByText(/11\/70 characters — search results usually show about 60$/)).toBeInTheDocument();
    expect(screen.getByText('20/180 characters — search results usually show about 160')).toBeInTheDocument();
  });

  it('says a community without a meta title uses a standard home page title, not "NEXUS"', async () => {
    mockAdminSettings.getSeoSettings.mockResolvedValue(makeSeoData({ tenant_meta_title: '' }));
    const { SeoOverview } = await import('./SeoOverview');
    render(<SeoOverview />);
    await waitForLoad();

    expect(screen.getByText('Not set — the home page uses a standard title ending with the community name')).toBeInTheDocument();
    expect(screen.queryByText(/NEXUS/)).not.toBeInTheDocument();
  });

  it('does not warn about a missing hub heading: only hub communities use it', async () => {
    mockAdminSettings.getSeoSettings.mockResolvedValue(makeSeoData({ tenant_h1_headline: '' }));
    const { SeoOverview } = await import('./SeoOverview');
    render(<SeoOverview />);
    await waitForLoad();

    const detail = screen.getByText('Not set — only needed for hub communities (communities with sub-communities)');
    expect(detail.closest('[data-testid="health-check-info"]')).not.toBeNull();
    expect(detail.closest('[data-testid="health-check-warning"]')).toBeNull();
  });

  it('explains what the canonical and sitemap switches really do', async () => {
    const { SeoOverview } = await import('./SeoOverview');
    render(<SeoOverview />);
    await waitForLoad();

    expect(screen.getByText(/Turning this off removes that link from every page\./)).toBeInTheDocument();
    expect(screen.getByText(/answer “not found” \(404\), so search engines get no sitemap\./)).toBeInTheDocument();
    expect(screen.getByText(/fallback description for pages that don't have their own/)).toBeInTheDocument();
    expect(screen.queryByText('Title Suffix.')).not.toBeInTheDocument();
    expect(screen.queryByText('Meta Keywords.')).not.toBeInTheDocument();
  });

  it('renders switch toggles for SEO features', async () => {
    const { SeoOverview } = await import('./SeoOverview');
    render(<SeoOverview />);

    await waitFor(() => {
      const switches = screen.getAllByTestId('switch');
      expect(switches.length).toBeGreaterThanOrEqual(4);
    });
  });

  // 2026-10-22: the owner uploaded a sharing image, refreshed, and lost it,
  // because only the page's Save button (at the bottom) stored it. The page now
  // stores the image by itself, and only that setting.
  it('stores an uploaded sharing image at once, sending only that setting', async () => {
    mockApiUpload.mockResolvedValue({ success: true, data: { url: 'https://cdn.example/share.png', path: 'p' } });
    const { SeoOverview } = await import('./SeoOverview');
    render(<SeoOverview />);
    const input = await screen.findByTestId('sharing-image-input');
    fireEvent.change(input, { target: { files: [new File(['png'], 'share.png', { type: 'image/png' })] } });

    await waitFor(() => expect(mockAdminSettings.updateSeoSettings).toHaveBeenCalledWith({
      seo_og_image_url: 'https://cdn.example/share.png',
    }));
  });
});

