// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for LegalAcceptanceGate component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/test-utils';

// LegalAcceptanceGate imports useTenant by its DIRECT path
// (`@/contexts/TenantContext`), so the mock must live on that specifier — a
// '@/contexts' barrel mock is never consulted and the real provider-backed hook
// throws outside TenantProvider. Partial mock so TenantProvider and the other
// exports stay real.
vi.mock('@/contexts/TenantContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/TenantContext')>()),
  useTenant: () => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    branding: { name: 'Test', logo_url: null },
    tenantSlug: 'test',
    tenantPath: (p: string) => '/test' + p,
    isLoading: false,
    hasFeature: () => true,
    hasModule: () => true,
  }),
}));

import { LegalAcceptanceGate } from '../LegalAcceptanceGate';
import type { PendingDocument } from '@/hooks/useLegalGate';

const mockPendingDocs: PendingDocument[] = [
  {
    document_id: 1,
    document_type: 'terms',
    title: 'Terms of Service',
    current_version_id: 10,
    current_version: '2.0',
    acceptance_status: 'not_accepted',
    accepted_at: null,
  },
  {
    document_id: 2,
    document_type: 'privacy',
    title: 'Privacy Policy',
    current_version_id: 11,
    current_version: '1.5',
    acceptance_status: 'outdated',
    accepted_at: '2025-01-01T00:00:00Z',
  },
];

describe('LegalAcceptanceGate', () => {
  let mockAcceptAll: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAcceptAll = vi.fn().mockResolvedValue(undefined);
  });

  it('renders without crashing', () => {
    render(
      <LegalAcceptanceGate
        pendingDocs={mockPendingDocs}
        onAcceptAll={mockAcceptAll}
        isAccepting={false}
      />
    );
    expect(screen.getByText('Updated legal documents')).toBeInTheDocument();
  });

  it('renders the correct count message for multiple documents', () => {
    render(
      <LegalAcceptanceGate
        pendingDocs={mockPendingDocs}
        onAcceptAll={mockAcceptAll}
        isAccepting={false}
      />
    );
    expect(screen.getByText(/2 documents have been updated/)).toBeInTheDocument();
  });

  it('renders singular message for one document', () => {
    render(
      <LegalAcceptanceGate
        pendingDocs={[mockPendingDocs[0]]}
        onAcceptAll={mockAcceptAll}
        isAccepting={false}
      />
    );
    expect(screen.getByText(/A document has been updated/)).toBeInTheDocument();
  });

  it('renders document type labels', () => {
    render(
      <LegalAcceptanceGate
        pendingDocs={mockPendingDocs}
        onAcceptAll={mockAcceptAll}
        isAccepting={false}
      />
    );
    expect(screen.getByText('Terms of Service')).toBeInTheDocument();
    expect(screen.getByText('Privacy Policy')).toBeInTheDocument();
  });

  it('shows "Updated" chip for outdated documents', () => {
    render(
      <LegalAcceptanceGate
        pendingDocs={mockPendingDocs}
        onAcceptAll={mockAcceptAll}
        isAccepting={false}
      />
    );
    expect(screen.getByText('Updated')).toBeInTheDocument();
  });

  it('renders "Read" links for each document', () => {
    render(
      <LegalAcceptanceGate
        pendingDocs={mockPendingDocs}
        onAcceptAll={mockAcceptAll}
        isAccepting={false}
      />
    );
    const readLinks = screen.getAllByText('Read');
    expect(readLinks).toHaveLength(2);
  });

  it('renders Accept & Continue button', () => {
    render(
      <LegalAcceptanceGate
        pendingDocs={mockPendingDocs}
        onAcceptAll={mockAcceptAll}
        isAccepting={false}
      />
    );
    expect(screen.getByLabelText('Accept all updated legal documents and continue')).toBeInTheDocument();
    expect(screen.getByText('Accept & Continue')).toBeInTheDocument();
  });

  it('shows "Accepting..." when isAccepting is true', () => {
    render(
      <LegalAcceptanceGate
        pendingDocs={mockPendingDocs}
        onAcceptAll={mockAcceptAll}
        isAccepting={true}
      />
    );
    expect(screen.getByText(/Accepting/)).toBeInTheDocument();
  });

  it('calls onAcceptAll when accept button is clicked', async () => {
    render(
      <LegalAcceptanceGate
        pendingDocs={mockPendingDocs}
        onAcceptAll={mockAcceptAll}
        isAccepting={false}
      />
    );

    const acceptBtn = screen.getByLabelText('Accept all updated legal documents and continue');
    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(mockAcceptAll).toHaveBeenCalledTimes(1);
    });
  });

  it('renders the disclaimer text', () => {
    render(
      <LegalAcceptanceGate
        pendingDocs={mockPendingDocs}
        onAcceptAll={mockAcceptAll}
        isAccepting={false}
      />
    );
    expect(screen.getByText(/By clicking Accept/)).toBeInTheDocument();
  });
});
