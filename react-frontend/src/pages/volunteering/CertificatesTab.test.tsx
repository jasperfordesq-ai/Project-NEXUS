// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for CertificatesTab
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { framerMotionMock } from '@/test/mocks';

vi.mock('@/lib/motion', () => framerMotionMock);

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [] }),
    post: vi.fn().mockResolvedValue({ success: true }),
    download: vi.fn().mockResolvedValue(new Blob()),
  },
  API_BASE: 'https://api.example.com',
}));

vi.mock('@/contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
    </div>
  ),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

import { CertificatesTab } from './CertificatesTab';
import { api } from '@/lib/api';

const mockCertificate = {
  id: 1,
  verification_code: 'CERT-ABC123',
  verification_url: 'https://example.com/verify/CERT-ABC123',
  total_hours: 24,
  date_range: { start: '2026-01-01', end: '2026-03-01' },
  organizations: [
    { name: 'Green Org', hours: 12, shifts: 3 },
    { name: 'Help Centre', hours: 12, shifts: 2 },
  ],
  generated_at: '2026-03-05T10:00:00Z',
  downloaded_at: null,
};

describe('CertificatesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the heading and description', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<CertificatesTab />);
    expect(screen.getByText('Impact Certificates')).toBeInTheDocument();
    expect(
      screen.getByText(/Certificates include all of your approved volunteer hours/),
    ).toBeInTheDocument();
  });

  it('renders Generate Certificate button', () => {
    render(<CertificatesTab />);
    expect(screen.getByRole('button', { name: /Generate Certificate/i })).toBeInTheDocument();
  });

  it('shows empty state when no certificates exist', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<CertificatesTab />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.getByText('No certificates yet')).toBeInTheDocument();
    });
  });

  it('displays certificate cards with hours, verification code, and org chips', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { certificates: [mockCertificate] },
    });
    render(<CertificatesTab />);
    await waitFor(() => {
      expect(screen.getByText('24 Verified Hours')).toBeInTheDocument();
    });
    expect(screen.getByText('CERT-ABC123')).toBeInTheDocument();
    expect(screen.getByText(/Green Org/)).toBeInTheDocument();
    expect(screen.getByText(/Help Centre/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Verify/i })).toBeInTheDocument();
  });

  it('downloads the certificate as a file through the authenticated client', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { certificates: [mockCertificate] } });
    render(<CertificatesTab />);
    await waitFor(() => expect(screen.getByText('CERT-ABC123')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Download/i }));

    await waitFor(() => expect(api.download).toHaveBeenCalledWith(
      '/v2/volunteering/certificates/CERT-ABC123/html',
      { filename: 'volunteer-certificate-CERT-ABC123.html' },
    ));
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  // Gap D8: a certificate the community revoked fails every check, so the
  // volunteer is told why and offered neither a download nor a check link.
  it('shows a revoked certificate as revoked with no download or check', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { items: [{ ...mockCertificate, revoked_at: '2026-10-07T09:00:00Z' }] },
    });
    render(<CertificatesTab />);
    await waitFor(() => expect(screen.getByText('CERT-ABC123')).toBeInTheDocument());

    expect(screen.getByText('Revoked')).toBeInTheDocument();
    expect(screen.getByText(/withdrawn this certificate/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Verify/i })).not.toBeInTheDocument();
  });

  it('calls POST when Generate Certificate button is pressed', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    vi.mocked(api.post).mockResolvedValue({ success: true });
    render(<CertificatesTab />);
    await waitFor(() => screen.getByTestId('empty-state'));

    fireEvent.click(screen.getAllByRole('button', { name: /Generate Certificate/i })[0]);
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v2/volunteering/certificates', {});
    });
  });

  it('shows error state when API call fails', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false, data: null });
    render(<CertificatesTab />);
    await waitFor(() => {
      expect(screen.getByText('Failed to load certificates')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument();
  });
});
