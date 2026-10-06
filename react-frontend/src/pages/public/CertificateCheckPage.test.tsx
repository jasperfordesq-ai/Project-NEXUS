// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for CertificateCheckPage — the public "code plus name" certificate check
 * (gap C1, owner decision 6 Oct 2026). Context mocks follow ContactPage.test.tsx:
 * PageMeta imports useTenant on its direct path, so the direct paths are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/test-utils';
import { Routes, Route } from 'react-router-dom';
import React from 'react';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  tokenManager: { getTenantId: vi.fn(), getToken: vi.fn() },
}));

const mockTenant = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
  branding: { name: 'Test Community', logo_url: null },
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
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

import { api } from '@/lib/api';
import { CertificateCheckPage } from './CertificateCheckPage';

function renderAt(path: string) {
  window.history.pushState({}, '', path);
  return render(
    <Routes>
      <Route path="/verify-certificate" element={<CertificateCheckPage />} />
      <Route path="/verify-certificate/:code" element={<CertificateCheckPage />} />
    </Routes>,
  );
}

function fillAndSubmit(code: string | null, name: string) {
  if (code !== null) {
    fireEvent.change(screen.getByRole('textbox', { name: /Certificate code/ }), { target: { value: code } });
  }
  fireEvent.change(screen.getByRole('textbox', { name: /Volunteer's name/ }), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Check certificate' }));
}

describe('CertificateCheckPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('prefills the code from the address but looks nothing up on its own', () => {
    renderAt('/verify-certificate/ABC123');

    expect(screen.getByRole('heading', { level: 1, name: 'Check a volunteering certificate' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Certificate code/ })).toHaveValue('ABC123');
    expect(screen.getByRole('button', { name: 'Check certificate' })).toBeDisabled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('sends the code and name, and shows what the certificate says when they match', async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      data: {
        valid: true,
        name: 'Ada Lovelace',
        total_hours: 24.5,
        date_range: { start: '2026-03-01', end: '2026-06-30' },
        organizations: [{ name: 'Food Bank', hours: 24.5 }],
        generated_at: '2026-07-01T10:00:00Z',
      },
    });
    renderAt('/verify-certificate/ABC123');

    fillAndSubmit(null, '  Ada Lovelace ');

    expect(await screen.findByTestId('certificate-check-valid')).toHaveTextContent('This certificate is genuine');
    expect(api.post).toHaveBeenCalledWith('/v2/volunteering/certificates/check', { code: 'ABC123', name: 'Ada Lovelace' });
    expect(screen.getByText('It matches a certificate this community issued to Ada Lovelace.')).toBeInTheDocument();
    expect(screen.getByText('Food Bank — hours: 24.5')).toBeInTheDocument();
  });

  it('says it could not confirm the certificate when they do not match', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { valid: false } });
    renderAt('/verify-certificate');

    fillAndSubmit('NOPE', 'Someone');

    expect(await screen.findByTestId('certificate-check-invalid')).toHaveTextContent('We could not confirm this certificate');
    expect(screen.queryByTestId('certificate-check-valid')).not.toBeInTheDocument();
  });

  it('shows a try-again message when the check itself fails', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: false, error: 'Too many requests' });
    renderAt('/verify-certificate');

    fillAndSubmit('ABC123', 'Ada Lovelace');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('We could not check the certificate just now.');
    });
  });
});
