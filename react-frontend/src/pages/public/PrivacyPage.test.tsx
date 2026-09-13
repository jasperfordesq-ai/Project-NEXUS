// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for PrivacyPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn().mockResolvedValue({ success: true, data: null }) },
  tokenManager: { getTenantId: vi.fn() },
}));

vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    branding: { name: 'Test Community' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
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

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useLegalDocument', () => ({
  useLegalDocument: vi.fn(() => ({ document: null, loading: false })),
}));
vi.mock('@/components/seo', () => ({ PageMeta: () => null }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
vi.mock('@/components/legal/CustomLegalDocument', () => ({
  default: () => <div data-testid="custom-legal">Custom Legal Doc</div>,
  CustomLegalDocument: () => <div data-testid="custom-legal">Custom Legal Doc</div>,
}));
// Stubbed so the SEO props can be asserted directly — see TermsPage.test.tsx.
vi.mock('@/components/seo/PageMeta', () => ({
  PageMeta: ({ title, description }: { title?: string; description?: string }) => (
    <div data-testid="page-meta" data-title={title} data-description={description} />
  ),
}));
vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const motionKeys = new Set(["variants", "initial", "animate", "transition", "whileInView", "viewport", "layout", "exit", "whileHover", "whileTap"]);
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) { if (!motionKeys.has(k)) rest[k] = v; }
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { PrivacyPage } from './PrivacyPage';
import { useLegalDocument, type LegalDocument } from '@/hooks/useLegalDocument';

const customPrivacyDoc: LegalDocument = {
  id: 2,
  document_id: 2,
  type: 'privacy',
  title: 'Our Own Privacy Policy',
  content: '<p>Tenant-authored privacy policy.</p>',
  version_number: '1.0',
  effective_date: '2026-01-01',
  summary_of_changes: null,
  has_previous_versions: false,
};

describe('PrivacyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks keeps implementations, so re-assert the default explicitly.
    vi.mocked(useLegalDocument).mockReturnValue({ document: null, loading: false });
  });

  // Regression: the customDoc branch returned CustomLegalDocument bare, so
  // /privacy had no meta description, no canonical and no Open Graph on every
  // tenant with its own policy. Found 2026-09-13 auditing prerender snapshots.
  it('still renders SEO tags when the tenant has its own privacy document', () => {
    vi.mocked(useLegalDocument).mockReturnValue({ document: customPrivacyDoc, loading: false });

    render(<PrivacyPage />);

    expect(screen.getByTestId('custom-legal')).toBeInTheDocument();
    const meta = screen.getByTestId('page-meta');
    expect(meta.getAttribute('data-title')).toBeTruthy();
    expect(meta.getAttribute('data-description')).toBeTruthy();
  });

  it('renders without crashing', () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/Privacy Policy/i)).toBeInTheDocument();
  });
});
