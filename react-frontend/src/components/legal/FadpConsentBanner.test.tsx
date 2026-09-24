// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// Mock api (default import used by FadpConsentBanner)
vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// Control localStorage reads/writes in isolation
const mockStorageMap: Record<string, string> = {};
vi.mock('@/lib/safeStorage', () => ({
  safeLocalStorageGet: (key: string) => mockStorageMap[key] ?? null,
  safeLocalStorageSet: (key: string, value: string) => { mockStorageMap[key] = value; },
}));

// hasFeature is the critical switch for this component
const mockHasFeature = vi.fn(() => false);
const mockIsAuthenticated = vi.fn(() => true);
const mockUser = vi.fn(() => ({ id: 7 }));

vi.mock('@/contexts', () => createMockContexts({
  useAuth: () => ({
    user: mockUser(),
    isAuthenticated: mockIsAuthenticated(),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUser: vi.fn(),
    refreshUser: vi.fn(),
    status: 'idle' as const,
    error: null,
  }),
  useTenant: () => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: mockHasFeature,
    hasModule: vi.fn(() => true),
  }),
}));

import api from '@/lib/api';
import { FadpConsentBanner } from './FadpConsentBanner';

function renderBanner() {
  return render(<FadpConsentBanner />);
}

const consentStorageKey = 'fadp_consented:2:7';

beforeEach(() => {
  mockIsAuthenticated.mockReturnValue(true);
  mockUser.mockReturnValue({ id: 7 });
});

describe('FadpConsentBanner — gate / visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockStorageMap).forEach((k) => delete mockStorageMap[k]);
  });

  it('renders nothing when fadp_compliance feature is disabled', () => {
    mockHasFeature.mockReturnValue(false);
    renderBanner();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('renders the banner when fadp_compliance feature is enabled', () => {
    mockHasFeature.mockReturnValue(true);
    renderBanner();
    const banner = screen.getByRole('region');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveClass('z-[310]');
    expect(banner.className).toContain('var(--safe-area-bottom)');
  });

  it('does not offer authenticated consent actions to a guest', () => {
    mockHasFeature.mockReturnValue(true);
    mockIsAuthenticated.mockReturnValue(false);
    renderBanner();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('renders nothing when already dismissed (localStorage fadp_consented=true)', () => {
    mockHasFeature.mockReturnValue(true);
    mockStorageMap[consentStorageKey] = 'true';
    renderBanner();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('shows banner content: title and body text', () => {
    mockHasFeature.mockReturnValue(true);
    renderBanner();
    expect(screen.getByText('Swiss Data Protection (nDSG)')).toBeInTheDocument();
    expect(screen.getByText(/Under the Swiss Federal Act/i)).toBeInTheDocument();
  });
});

describe('FadpConsentBanner — dismiss (X button)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockStorageMap).forEach((k) => delete mockStorageMap[k]);
    mockHasFeature.mockReturnValue(true);
  });

  it('hides the banner when the dismiss button is clicked', () => {
    renderBanner();
    const dismissBtn = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismissBtn);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('sets localStorage flag on dismiss', () => {
    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(mockStorageMap[consentStorageKey]).toBe('true');
  });

  it('does NOT call the consent API when dismissing via X button', () => {
    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('does not dismiss the banner for another member on the same browser', () => {
    const { rerender } = renderBanner();
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    mockUser.mockReturnValue({ id: 8 });
    rerender(<FadpConsentBanner />);
    expect(screen.getByRole('region')).toBeInTheDocument();
  });
});

describe('FadpConsentBanner — accept action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockStorageMap).forEach((k) => delete mockStorageMap[k]);
    mockHasFeature.mockReturnValue(true);
  });

  it('calls POST /v2/me/fadp/consent with action=granted on accept', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true });
    renderBanner();

    fireEvent.click(screen.getByText('Accept AI features'));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v2/me/fadp/consent', {
        consent_type: 'profiling',
        action: 'granted',
      });
    });
  });

  it('dismisses the banner after accepting', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true });
    renderBanner();
    fireEvent.click(screen.getByText('Accept AI features'));
    await waitFor(() => expect(screen.queryByRole('region')).not.toBeInTheDocument());
    expect(mockStorageMap[consentStorageKey]).toBe('true');
  });

  it('retains the banner with a retryable error if the API call throws', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('Network error'));
    renderBanner();
    fireEvent.click(screen.getByText('Accept AI features'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('region')).toBeInTheDocument();
    expect(mockStorageMap[consentStorageKey]).toBeUndefined();
  });

  it('retains the banner when the API resolves a failure envelope', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: false, code: 'NETWORK_ERROR' });
    renderBanner();
    fireEvent.click(screen.getByText('Accept AI features'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('region')).toBeInTheDocument();
    expect(mockStorageMap[consentStorageKey]).toBeUndefined();
  });
});

describe('FadpConsentBanner — decline action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockStorageMap).forEach((k) => delete mockStorageMap[k]);
    mockHasFeature.mockReturnValue(true);
  });

  it('calls POST /v2/me/fadp/consent with action=withdrawn on decline', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true });
    renderBanner();

    fireEvent.click(screen.getByText('Use basic features only'));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v2/me/fadp/consent', {
        consent_type: 'profiling',
        action: 'withdrawn',
      });
    });
  });

  it('dismisses the banner after declining', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true });
    renderBanner();
    fireEvent.click(screen.getByText('Use basic features only'));
    await waitFor(() => expect(screen.queryByRole('region')).not.toBeInTheDocument());
    expect(mockStorageMap[consentStorageKey]).toBe('true');
  });

  it('retains the banner if the decline API call throws', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('Server error'));
    renderBanner();
    fireEvent.click(screen.getByText('Use basic features only'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('region')).toBeInTheDocument();
    expect(mockStorageMap[consentStorageKey]).toBeUndefined();
  });
});
