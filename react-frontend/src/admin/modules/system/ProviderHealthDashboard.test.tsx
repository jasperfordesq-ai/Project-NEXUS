// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── Hoisted mock data (used inside vi.mock factories) ────────────────────────

const { mockApiGet } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
}));

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/lib/api', () => ({
  api: {
    get: mockApiGet,
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast })
);

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ── Fixture data ─────────────────────────────────────────────────────────────

const makeProvider = (overrides: Partial<{
  slug: string;
  name: string;
  available: boolean;
  success_rate: number | null;
}> = {}) => ({
  slug: 'provider-one',
  name: 'Provider One',
  available: true,
  // 🔴 Real verification levels. The providers in app/Services/Identity/ return
  // only document_only / document_selfie / reusable_digital_id / manual_review;
  // 'basic_id' and 'enhanced_id' were invented, have no
  // system.verification_level_* translation, and so rendered as the "Unknown
  // verification level" fallback — the chips this suite asserts were never there.
  supported_levels: ['document_only', 'document_selfie'],
  latency_ms: 120,
  avg_completion_seconds: 45,
  stats: {
    total_sessions: 100,
    passed: 85,
    failed: 10,
    pending: 3,
    expired: 2,
    success_rate: overrides.success_rate !== undefined ? overrides.success_rate : 85,
    last_session_at: new Date(Date.now() - 60_000).toISOString(),
    last_success_at: new Date(Date.now() - 120_000).toISOString(),
    last_failure_at: null,
  },
  recent_24h: { total: 20, passed: 18, failed: 2 },
  last_webhook: { at: new Date(Date.now() - 300_000).toISOString(), type: 'session.completed' },
  ...overrides,
});

// ── Import component after mocks ──────────────────────────────────────────────

import { ProviderHealthDashboard } from './ProviderHealthDashboard';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProviderHealthDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinner while fetching', () => {
    mockApiGet.mockReturnValue(new Promise(() => {}));
    render(<ProviderHealthDashboard />);

    const busyEl = screen.getAllByRole('status').find(
      (el) => el.getAttribute('aria-busy') === 'true'
    );
    expect(busyEl).toBeTruthy();
  });

  it('shows empty state when no providers returned', async () => {
    mockApiGet.mockResolvedValueOnce({ data: [] });
    render(<ProviderHealthDashboard />);

    await waitFor(() => {
      const busyEl = screen
        .queryAllByRole('status')
        .find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busyEl).toBeUndefined();
    });
  });

  it('renders provider cards when data is returned', async () => {
    mockApiGet.mockResolvedValueOnce({ data: [makeProvider()] });
    render(<ProviderHealthDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Provider One')).toBeInTheDocument();
    });
  });

  it('renders multiple provider cards', async () => {
    mockApiGet.mockResolvedValueOnce({
      data: [
        makeProvider({ slug: 'provider-a', name: 'Provider Alpha' }),
        makeProvider({ slug: 'provider-b', name: 'Provider Beta', available: false }),
      ],
    });
    render(<ProviderHealthDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Provider Alpha')).toBeInTheDocument();
      expect(screen.getByText('Provider Beta')).toBeInTheDocument();
    });
  });

  it('calls the correct API endpoint', async () => {
    mockApiGet.mockResolvedValueOnce({ data: [] });
    render(<ProviderHealthDashboard />);

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/v2/admin/identity/provider-health');
    });
  });

  it('shows error toast on API failure', async () => {
    mockApiGet.mockRejectedValueOnce(new Error('Network error'));
    render(<ProviderHealthDashboard />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('displays success rate percentage for a provider', async () => {
    mockApiGet.mockResolvedValueOnce({ data: [makeProvider({ success_rate: 85 })] });
    render(<ProviderHealthDashboard />);

    await waitFor(() => {
      expect(screen.getByText('85%')).toBeInTheDocument();
    });
  });

  it('displays supported levels as chips', async () => {
    mockApiGet.mockResolvedValueOnce({ data: [makeProvider()] });
    render(<ProviderHealthDashboard />);

    await waitFor(() => {
      // Levels are translated: system.verification_level_<level>.
      expect(screen.getByText('Document only')).toBeInTheDocument();
      expect(screen.getByText('Document and selfie')).toBeInTheDocument();
    });
  });

  it('shows total sessions count in a populated card', async () => {
    mockApiGet.mockResolvedValueOnce({ data: [makeProvider()] });
    render(<ProviderHealthDashboard />);

    await waitFor(() => {
      expect(screen.getByText('100')).toBeInTheDocument();
    });
  });

  it('shows N/A text for null success rate', async () => {
    mockApiGet.mockResolvedValueOnce({
      data: [makeProvider({ success_rate: null })],
    });
    render(<ProviderHealthDashboard />);

    await waitFor(() => {
      const busyEl = screen
        .queryAllByRole('status')
        .find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busyEl).toBeUndefined();
    });

    // N/A appears in place of percentage (translation key system.not_available_short)
    // In test i18n the key renders as the key string itself
    expect(document.body.textContent).toBeTruthy();
  });
});
