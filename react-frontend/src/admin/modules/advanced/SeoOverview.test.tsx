// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

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

const makeSitemapStats = () => ({
  data: {
    sitemap_url: 'https://example.com/sitemap.xml',
    total_urls: 42,
    content_types: { listings: 20, events: 10, members: 12 },
  },
  success: true,
});

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

  it('renders sitemap content_types as Chips', async () => {
    const { SeoOverview } = await import('./SeoOverview');
    render(<SeoOverview />);

    await waitFor(() => {
      expect(screen.getByText('Listings')).toBeInTheDocument();
      expect(screen.getByText('Events')).toBeInTheDocument();
      expect(screen.getByText('Members')).toBeInTheDocument();
    });
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

