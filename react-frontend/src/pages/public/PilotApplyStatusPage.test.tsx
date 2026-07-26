// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for PilotApplyStatusPage.
 *
 * Mocking notes
 * ─────────────
 * The page reaches `useTenant` twice over two different specifiers: it imports
 * the hook itself from the '@/contexts' barrel, but it also renders
 * `PageMeta` from '@/components/seo/PageMeta', and that module imports
 * `useTenant` from '@/contexts/TenantContext' — the DIRECT path. Vitest
 * resolves mocks per specifier, so a mock of the '@/contexts' barrel never
 * covered PageMeta and the real TenantContext loaded and threw
 * "useTenant must be used within a TenantProvider" before anything rendered.
 * (src/test/setup.ts globally stubs the '@/components/seo' barrel, which the
 * page also bypasses by importing the module directly.)
 *
 * Mocking '@/contexts/TenantContext' on its DIRECT path covers both callers:
 * '@/contexts/index.ts' re-exports from './TenantContext', so the real barrel
 * loads and hands out the stubbed hook. '@/contexts/AuthContext' is mocked the
 * same way because the barrel re-exports from it too, and the real AuthContext
 * imports named events from '@/lib/api' that this file's api stub does not
 * provide.
 *
 * Both context mocks are deliberately total (no importOriginal): the real
 * TenantContext and AuthContext import '@/i18n', which re-runs i18next `.init()`
 * with the HTTP/localStorage backends at module scope.
 *
 * • The page reads `token` from useParams and issues a GET request.
 * • We mock react-router-dom to control useParams.
 * • We mock @/lib/api to control the API response.
 * • Loading, found (success), not-found/error, and API-error branches are covered.
 * • The page uses useTranslation('common') and src/test/setup.ts preloads the
 *   committed English locale files, so assertions use real user-facing copy.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import React from 'react';

// ── react-router-dom: mock useParams ─────────────────────────────────────────
// We need to keep the real BrowserRouter/Link etc. from the actual module.
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useParams: vi.fn(() => ({ token: 'abc-token-123' })),
  };
});

// ── API mock ──────────────────────────────────────────────────────────────────
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  tokenManager: { getTenantId: vi.fn(), getToken: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ── Contexts (DIRECT paths — see header note) ─────────────────────────────────
const mockTenant = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
  branding: { name: 'Test Community', logo_url: null, tagline: 'A test community' },
  tenantPath: (p: string) => `/test${p}`,
  hasFeature: () => true,
  hasModule: () => true,
  isLoading: false,
  error: null,
};

const mockAuth = { user: null, isAuthenticated: false };

vi.mock('@/contexts/TenantContext', () => ({
  TenantProvider: ({ children }: { children: React.ReactNode }) => children,
  useTenant: () => mockTenant,
  useFeature: () => true,
  useModule: () => true,
}));

vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => mockAuth,
  useAuthOptional: () => mockAuth,
}));

vi.mock('@/lib/motion', () => {
  const motionProxy = new Proxy({}, {
    get: (_target, prop) => {
      return React.forwardRef(
        ({ children, ...props }: Record<string, unknown>, ref: unknown) => {
          const clean = { ...props };
          delete clean.variants; delete clean.initial; delete clean.animate;
          delete clean.exit; delete clean.transition;
          const Tag = typeof prop === 'string' ? prop : 'div';
          return React.createElement(Tag, { ...clean, ref }, children);
        },
      );
    },
  });
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children: unknown }) =>
      React.createElement(React.Fragment, null, children),
    MotionConfig: ({ children }: { children: unknown }) =>
      React.createElement(React.Fragment, null, children),
  };
});

import { PilotApplyStatusPage } from './PilotApplyStatusPage';
import { api } from '@/lib/api';
import { useParams } from 'react-router-dom';

const MOCK_STATUS_INFO = {
  org_name: 'Acme Timebank',
  requested_slug: 'acme-timebank',
  status: 'pending',
  provisioned_tenant_id: null,
  created_at: '2026-01-01T00:00:00Z',
  reviewed_at: null,
};

// Real English copy from public/locales/en/common.json (`provisioning.*`),
// preloaded into i18next by src/test/setup.ts.
const PAGE_HEADING = 'Application status';
const LOADING_LABEL = 'Loading...';
const ORG_NAME_LABEL = 'Organisation / community name';
const SLUG_LABEL = 'Community URL slug';
const LOOKUP_FAILED = 'We could not find an application for that link.';
const CHECK_EMAIL = 'Please check your email for updates on your application.';
const BACK_HOME = 'Back to home';
const STATUS_LABELS = {
  pending: 'Received — awaiting review',
  under_review: 'Under review',
  approved: 'Approved — provisioning in progress',
  provisioned: 'Provisioned — your community is live',
  rejected: 'Not approved',
  failed: 'A technical issue occurred — our team has been notified',
} as const;

describe('PilotApplyStatusPage — loading state', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows a loading spinner initially', () => {
    // api.get never resolves so the component stays in loading state
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<PilotApplyStatusPage />);

    // Page chrome renders immediately with the real English heading…
    expect(
      screen.getByRole('heading', { level: 1, name: PAGE_HEADING })
    ).toBeInTheDocument();

    // …and the busy live region is labelled with the real loading copy and
    // wraps the Spinner (which is its own role="status" element).
    const busyRegion = screen.getByLabelText(LOADING_LABEL, {
      selector: '[aria-busy="true"]',
    });
    expect(busyRegion).toHaveAttribute('role', 'status');
    expect(busyRegion.querySelector('[role="status"]')).toBeInTheDocument();

    // The heading assertion above is the positive precondition that makes
    // these absences meaningful rather than vacuous.
    expect(screen.queryByText('Acme Timebank')).not.toBeInTheDocument();
    expect(screen.queryByText(LOOKUP_FAILED)).not.toBeInTheDocument();
  });
});

describe('PilotApplyStatusPage — success (status found)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders org_name after API resolves', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: MOCK_STATUS_INFO });
    render(<PilotApplyStatusPage />);
    const orgValue = await screen.findByText('Acme Timebank');
    // Proven to sit in the org-name field, not merely somewhere on the page.
    expect(orgValue.parentElement).toContainElement(screen.getByText(ORG_NAME_LABEL));
  });

  it('renders the requested_slug', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: MOCK_STATUS_INFO });
    render(<PilotApplyStatusPage />);
    const slugValue = await screen.findByText('acme-timebank');
    expect(slugValue.parentElement).toContainElement(screen.getByText(SLUG_LABEL));
  });

  it('renders a status chip for the pending state', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: MOCK_STATUS_INFO });
    render(<PilotApplyStatusPage />);
    // Real translated label for provisioning.status_labels.pending.
    const chipLabel = await screen.findByText(STATUS_LABELS.pending);
    // …rendered inside an actual Chip, not loose text.
    expect(chipLabel.closest('[data-slot="chip"]')).toBeInTheDocument();
    expect(screen.queryByText(LOOKUP_FAILED)).not.toBeInTheDocument();
  });

  it('calls the correct API endpoint with the token from useParams', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: MOCK_STATUS_INFO });
    render(<PilotApplyStatusPage />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        '/v2/provisioning-requests/status/abc-token-123',
      );
    });
  });

  it('renders a back-home button after data loads', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: MOCK_STATUS_INFO });
    render(<PilotApplyStatusPage />);
    // Wait for the data branch so the assertion is about the loaded page.
    await screen.findByText('Acme Timebank');
    const backLink = screen.getByRole('link', { name: BACK_HOME });
    // tenantPath('/') from the tenant stub.
    expect(backLink).toHaveAttribute('href', '/test/');
  });

  it('wraps the data shape correctly — response.data path', async () => {
    // Component also handles a raw response (no .data envelope)
    vi.mocked(api.get).mockResolvedValue(MOCK_STATUS_INFO);
    render(<PilotApplyStatusPage />);
    const orgValue = await screen.findByText('Acme Timebank');
    expect(orgValue.parentElement).toContainElement(screen.getByText(ORG_NAME_LABEL));
  });
});

describe('PilotApplyStatusPage — error / not found', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows an error message when the API resolves with invalid data', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { something_else: true } });
    render(<PilotApplyStatusPage />);
    // The real error copy replaces the busy region.
    expect(await screen.findByText(LOOKUP_FAILED)).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    // Not the success branch, and not the "no info" fallback either.
    expect(screen.queryByText('Acme Timebank')).not.toBeInTheDocument();
    expect(screen.queryByText(CHECK_EMAIL)).not.toBeInTheDocument();
  });

  it('shows an error message when the API throws', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));
    render(<PilotApplyStatusPage />);
    expect(await screen.findByText(LOOKUP_FAILED)).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.queryByText('Acme Timebank')).not.toBeInTheDocument();
  });

  it('does not call the API when there is no token', async () => {
    vi.mocked(useParams).mockReturnValue({});
    render(<PilotApplyStatusPage />);
    // Positive precondition: the page really did render and is still in its
    // loading branch — the effect returned early rather than the page failing.
    expect(
      screen.getByRole('heading', { level: 1, name: PAGE_HEADING })
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(LOADING_LABEL, { selector: '[aria-busy="true"]' })
    ).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
    // Reset for subsequent tests
    vi.mocked(useParams).mockReturnValue({ token: 'abc-token-123' });
  });
});

describe('PilotApplyStatusPage — status variations', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const STATUSES = ['pending', 'under_review', 'approved', 'provisioned', 'rejected', 'failed'] as const;

  for (const status of STATUSES) {
    // Title kept verbatim from the original suite; the body now also proves the
    // per-status chip label resolves to real translated copy.
    it(`renders org_name without crash for status="${status}"`, async () => {
      vi.mocked(api.get).mockResolvedValue({
        data: { ...MOCK_STATUS_INFO, status },
      });
      render(<PilotApplyStatusPage />);
      const orgValue = await screen.findByText('Acme Timebank');
      expect(orgValue.parentElement).toContainElement(screen.getByText(ORG_NAME_LABEL));
      // Every status maps to a real translated chip label — a missing key would
      // render the raw "provisioning.status_labels.<status>" string instead.
      expect(screen.getByText(STATUS_LABELS[status])).toBeInTheDocument();
    });
  }
});
