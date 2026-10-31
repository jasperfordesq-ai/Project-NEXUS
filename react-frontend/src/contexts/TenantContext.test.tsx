// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for TenantContext
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TenantProvider, useTenant, useFeature, useModule } from './TenantContext';
import { tokenManager } from '@/lib/api';

// Mock dependencies
const mockApiGet = vi.fn();
const mockFetchCsrfToken = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    clearInflightRequests: vi.fn(),
  },
  tokenManager: {
    getSessionGeneration: vi.fn().mockReturnValue('test-session'),
    runIfSessionCurrent: vi.fn(async (_expected: string | null, commit: () => unknown) => commit()),
    getTenantId: vi.fn().mockReturnValue(null),
    setTenantId: vi.fn(),
    getTenantSlug: vi.fn().mockReturnValue(null),
    setTenantSlug: vi.fn(),
    hasAccessToken: vi.fn().mockReturnValue(false),
    hasRefreshToken: vi.fn().mockReturnValue(false),
    clearTokens: vi.fn(),
  },
  fetchCsrfToken: (...args: unknown[]) => mockFetchCsrfToken(...args),
  COMMUNITY_CHANGED_EVENT: 'nexus:community_changed',
}));

vi.mock('@/lib/tenant-routing', () => ({
  detectTenantFromUrl: vi.fn().mockReturnValue({ slug: null, source: null }),
  tenantPath: (path: string, slug: string | null) => {
    if (!slug) return path;
    const normalized = path.startsWith('/') ? path : '/' + path;
    return '/' + slug + normalized;
  },
}));

vi.mock('@/lib/api-validation', () => ({
  validateResponseIfPresent: vi.fn((_schema: unknown, data: unknown) => data),
}));

vi.mock('@/lib/api-schemas', () => ({
  tenantBootstrapSchema: {},
}));

const mockTenantConfig = {
  id: 2,
  name: 'hOUR Timebank',
  slug: 'hour-timebank',
  tagline: 'Time Exchange Community',
  features: {
    gamification: true,
    events: true,
    groups: true,
    exchange_workflow: true,
  },
  modules: {
    feed: true,
    listings: true,
    wallet: true,
    messages: false,
  },
  branding: {
    name: 'hOUR',
    primaryColor: '#6366f1',
  },
};

function TestConsumer() {
  const {
    tenant,
    refreshTenant,
    isLoading,
    error,
    branding,
    hasFeature,
    hasModule,
    tenantSlug,
    tenantPath,
  } = useTenant();

  return (
    <div>
      <div data-testid="loading">{String(isLoading)}</div>
      <div data-testid="error">{error || 'none'}</div>
      <div data-testid="tenant-name">{tenant?.name || 'none'}</div>
      <div data-testid="tenant-slug">{tenantSlug || 'none'}</div>
      <div data-testid="has-gamification">{String(hasFeature('gamification'))}</div>
      <div data-testid="has-events">{String(hasFeature('events'))}</div>
      <div data-testid="has-feed">{String(hasModule('feed'))}</div>
      <div data-testid="has-messages">{String(hasModule('messages'))}</div>
      <div data-testid="branding-name">{branding.name}</div>
      <div data-testid="branding-color">{branding.primaryColor}</div>
      <div data-testid="path-test">{tenantPath('/dashboard')}</div>
      <button data-testid="refresh-silent" onClick={() => void refreshTenant({ silent: true })}>silent</button>
      <button data-testid="refresh-loud" onClick={() => void refreshTenant()}>loud</button>
    </div>
  );
}

describe('TenantContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tokenManager.getSessionGeneration).mockReturnValue('test-session');
    vi.mocked(tokenManager.runIfSessionCurrent).mockImplementation(async (expected, commit) => (
      tokenManager.getSessionGeneration() === expected ? commit() : null
    ));
  });

  it('does not clear or retarget session B when bootstrap A resolves late', async () => {
    vi.mocked(tokenManager.getSessionGeneration).mockReturnValue('account-a');
    vi.mocked(tokenManager.getTenantId).mockReturnValue('2');
    let resolveBootstrap!: (value: { success: true; data: typeof mockTenantConfig }) => void;
    mockApiGet.mockReturnValueOnce(new Promise((resolve) => { resolveBootstrap = resolve; }));

    render(
      <TenantProvider>
        <TestConsumer />
      </TenantProvider>,
    );
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    vi.mocked(tokenManager.getSessionGeneration).mockReturnValue('account-b');
    resolveBootstrap({
      success: true,
      data: { ...mockTenantConfig, id: 3, slug: 'replacement-target' },
    });
    await Promise.resolve();

    expect(tokenManager.clearTokens).not.toHaveBeenCalled();
    expect(tokenManager.setTenantId).not.toHaveBeenCalledWith(3);
  });

  it('keeps the session when the community changes and asks for it to be re-checked', async () => {
    // Owner, 12 Oct 2026: the server decides who may be signed in where. The
    // tokens are no longer cleared here; AuthContext re-asks the server.
    vi.mocked(tokenManager.getTenantId).mockReturnValue('2');
    vi.mocked(tokenManager.hasAccessToken).mockReturnValue(true);
    mockApiGet.mockResolvedValue({ success: true, data: { ...mockTenantConfig, id: 101, slug: 'child-community' } });
    const heard = vi.fn();
    window.addEventListener('nexus:community_changed', heard);

    render(
      <TenantProvider>
        <TestConsumer />
      </TenantProvider>,
    );

    await waitFor(() => expect(tokenManager.setTenantId).toHaveBeenCalledWith(101));
    await waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
    expect(tokenManager.clearTokens).not.toHaveBeenCalled();
    window.removeEventListener('nexus:community_changed', heard);
    vi.mocked(tokenManager.hasAccessToken).mockReturnValue(false);
    vi.mocked(tokenManager.getTenantId).mockReturnValue(null);
  });

  it('does not ask for a re-check when the community is unchanged', async () => {
    vi.mocked(tokenManager.getTenantId).mockReturnValue('2');
    vi.mocked(tokenManager.hasAccessToken).mockReturnValue(true);
    mockApiGet.mockResolvedValue({ success: true, data: mockTenantConfig });
    const heard = vi.fn();
    window.addEventListener('nexus:community_changed', heard);

    render(
      <TenantProvider>
        <TestConsumer />
      </TenantProvider>,
    );

    await waitFor(() => expect(tokenManager.setTenantId).toHaveBeenCalledWith(2));
    expect(heard).not.toHaveBeenCalled();
    window.removeEventListener('nexus:community_changed', heard);
    vi.mocked(tokenManager.hasAccessToken).mockReturnValue(false);
    vi.mocked(tokenManager.getTenantId).mockReturnValue(null);
  });

  // Found on the 31 Oct AWID walkthrough: a signed-in member who chose English
  // was switched to the community's Spanish whenever the community re-loaded.
  describe('community language', () => {
    const spanishCommunity = { ...mockTenantConfig, default_language: 'es' };

    it('applies the community language to a signed-out visitor', async () => {
      const i18n = (await import('@/i18n')).default;
      await i18n.changeLanguage('en');
      localStorage.removeItem('nexus_language_user_chosen');
      vi.mocked(tokenManager.hasAccessToken).mockReturnValue(false);
      mockApiGet.mockResolvedValue({ success: true, data: spanishCommunity });

      render(<TenantProvider><TestConsumer /></TenantProvider>);

      await waitFor(() => expect(i18n.language).toBe('es'));
    });

    it("leaves a signed-in member's own language alone", async () => {
      const i18n = (await import('@/i18n')).default;
      await i18n.changeLanguage('en');
      localStorage.removeItem('nexus_language_user_chosen');
      vi.mocked(tokenManager.hasAccessToken).mockReturnValue(true);
      mockApiGet.mockResolvedValue({ success: true, data: spanishCommunity });

      render(<TenantProvider><TestConsumer /></TenantProvider>);

      await waitFor(() => expect(tokenManager.setTenantId).toHaveBeenCalledWith(2));
      expect(i18n.language).toBe('en');
      vi.mocked(tokenManager.hasAccessToken).mockReturnValue(false);
    });
  });

  it('silent refresh keeps the current tenant on screen while re-fetching', async () => {
    mockApiGet.mockResolvedValueOnce({ success: true, data: mockTenantConfig });
    render(<TenantProvider><TestConsumer /></TenantProvider>);
    await waitFor(() => expect(screen.getByTestId('tenant-name')).toHaveTextContent('hOUR Timebank'));

    const seenLoading: string[] = [];
    const observer = new MutationObserver(() => seenLoading.push(screen.getByTestId('loading').textContent ?? ''));
    observer.observe(screen.getByTestId('loading'), { childList: true, characterData: true, subtree: true });

    let resolveRefresh!: (value: unknown) => void;
    mockApiGet.mockReturnValueOnce(new Promise((resolve) => { resolveRefresh = resolve; }));
    screen.getByTestId('refresh-silent').click();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(2));

    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('tenant-name')).toHaveTextContent('hOUR Timebank');

    resolveRefresh({ success: true, data: { ...mockTenantConfig, name: 'Renamed Timebank' } });
    await waitFor(() => expect(screen.getByTestId('tenant-name')).toHaveTextContent('Renamed Timebank'));
    observer.disconnect();
    expect(seenLoading).not.toContain('true');
  });

  it('silent refresh that fails keeps the current tenant and shows no error', async () => {
    mockApiGet.mockResolvedValueOnce({ success: true, data: mockTenantConfig });
    render(<TenantProvider><TestConsumer /></TenantProvider>);
    await waitFor(() => expect(screen.getByTestId('tenant-name')).toHaveTextContent('hOUR Timebank'));

    mockApiGet.mockResolvedValueOnce({ success: false, code: 'SERVER_ERROR' });
    screen.getByTestId('refresh-silent').click();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(2));
    await Promise.resolve();

    expect(screen.getByTestId('tenant-name')).toHaveTextContent('hOUR Timebank');
    expect(screen.getByTestId('error')).toHaveTextContent('none');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('a normal refresh still shows the loading state', async () => {
    mockApiGet.mockResolvedValueOnce({ success: true, data: mockTenantConfig });
    render(<TenantProvider><TestConsumer /></TenantProvider>);
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    mockApiGet.mockReturnValueOnce(new Promise(() => {}));
    screen.getByTestId('refresh-loud').click();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('true'));
  });

  it('shows loading state initially', async () => {
    // Use a long-delayed promise instead of a never-resolving one
    // to prevent Vitest from hanging indefinitely
    let resolveBootstrap: (value: unknown) => void;
    mockApiGet.mockReturnValue(new Promise((resolve) => { resolveBootstrap = resolve; }));

    render(
      <TenantProvider>
        <TestConsumer />
      </TenantProvider>
    );

    expect(screen.getByTestId('loading')).toHaveTextContent('true');

    // Clean up: resolve the promise so Vitest can exit cleanly
    resolveBootstrap!({ success: true, data: {} });
  });

  it('loads tenant data from bootstrap API', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockTenantConfig });

    render(
      <TenantProvider>
        <TestConsumer />
      </TenantProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('tenant-name')).toHaveTextContent('hOUR Timebank');
    expect(screen.getByTestId('has-gamification')).toHaveTextContent('true');
    expect(screen.getByTestId('has-events')).toHaveTextContent('true');
    expect(screen.getByTestId('has-feed')).toHaveTextContent('true');
  });

  it('reports feature checks correctly', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockTenantConfig });

    render(
      <TenantProvider>
        <TestConsumer />
      </TenantProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    // gamification is enabled in mockTenantConfig
    expect(screen.getByTestId('has-gamification')).toHaveTextContent('true');
  });

  it('reports module checks correctly (disabled module)', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockTenantConfig });

    render(
      <TenantProvider>
        <TestConsumer />
      </TenantProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    // messages is false in mockTenantConfig
    expect(screen.getByTestId('has-messages')).toHaveTextContent('false');
  });

  it('uses branding from tenant config with fallbacks', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockTenantConfig });

    render(
      <TenantProvider>
        <TestConsumer />
      </TenantProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    // name comes from top-level tenant.name (not branding.name)
    expect(screen.getByTestId('branding-name')).toHaveTextContent('hOUR Timebank');
    expect(screen.getByTestId('branding-color')).toHaveTextContent('#6366f1');
  });

  it('handles API error', async () => {
    mockApiGet.mockResolvedValue({ success: false, error: 'Server error' });

    render(
      <TenantProvider>
        <TestConsumer />
      </TenantProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    // TenantContext no longer surfaces the API's error prose. It exposes a stable control-flow
    // CODE that the consuming screen localizes — see the `admin-i18n-ignore` note on the provider's
    // TENANT_BOOTSTRAP_FAILED branch. A response with no `code` and no explicit TENANT_NOT_FOUND
    // is treated as retryable, so this is the bootstrap-failed code rather than the soft-404 one.
    expect(screen.getByTestId('error')).toHaveTextContent('TENANT_BOOTSTRAP_FAILED');
    expect(screen.getByTestId('tenant-name')).toHaveTextContent('none');
  });

  it('handles network exception', async () => {
    mockApiGet.mockRejectedValue(new Error('Network failed'));

    render(
      <TenantProvider>
        <TestConsumer />
      </TenantProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    // Thrown errors take the provider's catch branch, which sets the same stable
    // TENANT_BOOTSTRAP_FAILED code rather than echoing the exception message.
    expect(screen.getByTestId('error')).toHaveTextContent('TENANT_BOOTSTRAP_FAILED');
  });

  it('uses default features when tenant has none', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: { id: 1, name: 'Test', slug: 'test' },
    });

    render(
      <TenantProvider>
        <TestConsumer />
      </TenantProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    // Default for gamification is true (synced with PHP TenantFeatureConfig::FEATURE_DEFAULTS)
    expect(screen.getByTestId('has-gamification')).toHaveTextContent('true');
    // Default for events is true
    expect(screen.getByTestId('has-events')).toHaveTextContent('true');
  });

  it('uses default branding when tenant has none', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: { id: 1, name: 'Test', slug: 'test' },
    });

    render(
      <TenantProvider>
        <TestConsumer />
      </TenantProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('branding-name')).toHaveTextContent('Test');
    expect(screen.getByTestId('branding-color')).toHaveTextContent('#6366f1');
  });

  it('passes tenantSlug prop to bootstrap API', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockTenantConfig });

    render(
      <TenantProvider tenantSlug="hour-timebank">
        <TestConsumer />
      </TenantProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(mockApiGet).toHaveBeenCalledWith(
      expect.stringContaining('slug=hour-timebank'),
      expect.any(Object)
    );
  });

  it('builds tenant path with slug', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockTenantConfig });

    render(
      <TenantProvider tenantSlug="hour-timebank">
        <TestConsumer />
      </TenantProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('path-test')).toHaveTextContent('/hour-timebank/dashboard');
  });

  it('throws error when useTenant is outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<TestConsumer />);
    }).toThrow('useTenant must be used within a TenantProvider');

    spy.mockRestore();
  });

  it('fetches CSRF token after bootstrap', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockTenantConfig });

    render(
      <TenantProvider>
        <TestConsumer />
      </TenantProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(mockFetchCsrfToken).toHaveBeenCalled();
  });
});

describe('useFeature', () => {
  it('returns feature status', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockTenantConfig });

    function FeatureTestComponent() {
      const hasGamification = useFeature('gamification');
      return <div data-testid="feature">{String(hasGamification)}</div>;
    }

    render(
      <TenantProvider>
        <FeatureTestComponent />
      </TenantProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('feature')).toHaveTextContent('true');
    });
  });
});

describe('useModule', () => {
  it('returns module status', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockTenantConfig });

    function ModuleTestComponent() {
      const hasFeed = useModule('feed');
      return <div data-testid="module">{String(hasFeed)}</div>;
    }

    render(
      <TenantProvider>
        <ModuleTestComponent />
      </TenantProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('module')).toHaveTextContent('true');
    });
  });
});
