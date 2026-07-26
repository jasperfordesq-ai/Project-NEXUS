// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import type { PendingDocument } from '@/hooks/useLegalGate';

// ─── No API calls — LegalAcceptanceGate receives props; no internal fetching ──

// ─── Contexts ─────────────────────────────────────────────────────────────────
// LegalAcceptanceGate imports useTenant by its DIRECT path
// (`@/contexts/TenantContext`), so the mock must live on that specifier — a
// '@/contexts' barrel mock is never consulted and the real provider-backed hook
// throws outside TenantProvider. Partial mock so TenantProvider and the other
// exports stay real.
vi.mock('@/contexts/TenantContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/TenantContext')>()),
  useTenant: () => ({
    tenant: { id: 2, name: 'Test', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: () => true,
    hasModule: () => true,
  }),
}));

// The real HeroUI Modal/Button/Chip render fine in jsdom, so there is no stub
// layer here: assertions below target the real DOM and the real English copy
// that src/test/setup.ts loads from public/locales/en/legal.json.

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeDoc = (overrides: Partial<PendingDocument> = {}): PendingDocument => ({
  document_id: 1,
  document_type: 'terms',
  title: 'Terms of Service',
  current_version_id: 3,
  current_version: '1.2',
  acceptance_status: 'not_accepted',
  accepted_at: null,
  ...overrides,
});

const defaultProps = {
  pendingDocs: [makeDoc()],
  onAcceptAll: vi.fn().mockResolvedValue(undefined),
  isAccepting: false,
};

const ACCEPT_ARIA = 'Accept all updated legal documents and continue';

// ─────────────────────────────────────────────────────────────────────────────
describe('LegalAcceptanceGate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    defaultProps.onAcceptAll = vi.fn().mockResolvedValue(undefined);
  });

  it('renders the modal dialog when pendingDocs are provided', async () => {
    const { LegalAcceptanceGate } = await import('./LegalAcceptanceGate');
    render(<LegalAcceptanceGate {...defaultProps} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders the modal header', async () => {
    const { LegalAcceptanceGate } = await import('./LegalAcceptanceGate');
    render(<LegalAcceptanceGate {...defaultProps} />);

    // The heading carries the id the Modal is aria-labelledby'd to, so this
    // asserts both the header copy and the dialog's accessible-name wiring.
    const heading = screen.getByRole('heading', { name: 'Updated legal documents' });
    expect(heading).toHaveAttribute('id', 'legal-gate-title');
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', 'legal-gate-title');
  });

  it('renders a document row for each pending document', async () => {
    const docs = [
      makeDoc({ document_id: 1, document_type: 'terms', title: 'Terms of Service' }),
      makeDoc({ document_id: 2, document_type: 'privacy', title: 'Privacy Policy' }),
    ];
    const { LegalAcceptanceGate } = await import('./LegalAcceptanceGate');
    render(<LegalAcceptanceGate {...defaultProps} pendingDocs={docs} />);

    // Each document row shows its translated type label plus its own Read link.
    expect(screen.getByText('Terms of Service')).toBeInTheDocument();
    expect(screen.getByText('Privacy Policy')).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links.length).toBe(2);
  });

  it('renders a Read link for each document', async () => {
    const { LegalAcceptanceGate } = await import('./LegalAcceptanceGate');
    render(<LegalAcceptanceGate {...defaultProps} pendingDocs={[makeDoc({ document_type: 'privacy' })]} />);

    expect(screen.getAllByRole('link', { name: /Read/ })).toHaveLength(1);
  });

  it('document Read link points to the correct tenant path', async () => {
    const { LegalAcceptanceGate } = await import('./LegalAcceptanceGate');
    render(<LegalAcceptanceGate {...defaultProps} pendingDocs={[makeDoc({ document_type: 'terms' })]} />);

    const links = screen.getAllByRole('link');
    const termsLink = links.find((l) => l.getAttribute('href')?.includes('/terms'));
    expect(termsLink).toBeDefined();
  });

  it('renders an "Updated" chip for outdated documents', async () => {
    const outdatedDoc = makeDoc({ acceptance_status: 'outdated' });
    const { LegalAcceptanceGate } = await import('./LegalAcceptanceGate');
    render(<LegalAcceptanceGate {...defaultProps} pendingDocs={[outdatedDoc]} />);

    expect(screen.getByText('Updated')).toBeInTheDocument();
  });

  it('does not render an "Updated" chip for not_accepted documents', async () => {
    const freshDoc = makeDoc({ acceptance_status: 'not_accepted' });
    const { LegalAcceptanceGate } = await import('./LegalAcceptanceGate');
    render(<LegalAcceptanceGate {...defaultProps} pendingDocs={[freshDoc]} />);

    // Exact-text query, so the "Updated legal documents" title is not a match.
    expect(screen.queryByText('Updated')).not.toBeInTheDocument();
  });

  it('renders the accept button in the footer', async () => {
    const { LegalAcceptanceGate } = await import('./LegalAcceptanceGate');
    render(<LegalAcceptanceGate {...defaultProps} />);

    const btn = screen.getByRole('button', { name: ACCEPT_ARIA });
    expect(btn).toHaveTextContent('Accept & Continue');
  });

  it('calls onAcceptAll when the accept button is clicked', async () => {
    const onAcceptAll = vi.fn().mockResolvedValue(undefined);
    const { LegalAcceptanceGate } = await import('./LegalAcceptanceGate');
    render(<LegalAcceptanceGate {...defaultProps} onAcceptAll={onAcceptAll} />);

    fireEvent.click(screen.getByRole('button', { name: ACCEPT_ARIA }));

    await waitFor(() => {
      expect(onAcceptAll).toHaveBeenCalledTimes(1);
    });
  });

  it('accept button is disabled when isAccepting=true', async () => {
    const { LegalAcceptanceGate } = await import('./LegalAcceptanceGate');
    render(<LegalAcceptanceGate {...defaultProps} isAccepting={true} />);

    expect(screen.getByRole('button', { name: ACCEPT_ARIA })).toBeDisabled();
  });

  it('accept button shows loading text when isAccepting=true', async () => {
    const onAcceptAll = vi.fn().mockResolvedValue(undefined);
    const { LegalAcceptanceGate } = await import('./LegalAcceptanceGate');
    render(<LegalAcceptanceGate {...defaultProps} onAcceptAll={onAcceptAll} isAccepting={true} />);

    // Real button swaps its label to gate.accepting and refuses further presses.
    const btn = screen.getByRole('button', { name: ACCEPT_ARIA });
    expect(btn).toHaveTextContent('Accepting');
    expect(btn).not.toHaveTextContent('Accept & Continue');
    fireEvent.click(btn);
    expect(onAcceptAll).not.toHaveBeenCalled();
  });

  it('shows subtitle for a single pending document', async () => {
    const { LegalAcceptanceGate } = await import('./LegalAcceptanceGate');
    render(<LegalAcceptanceGate {...defaultProps} pendingDocs={[makeDoc()]} />);

    expect(
      screen.getByText('A document has been updated. Please review and accept it to continue.')
    ).toBeInTheDocument();
  });

  it('shows subtitle for multiple pending documents', async () => {
    const docs = [makeDoc({ document_id: 1 }), makeDoc({ document_id: 2, document_type: 'privacy' })];
    const { LegalAcceptanceGate } = await import('./LegalAcceptanceGate');
    render(<LegalAcceptanceGate {...defaultProps} pendingDocs={docs} />);

    expect(
      screen.getByText('2 documents have been updated. Please review and accept them to continue.')
    ).toBeInTheDocument();
  });

  it('renders consent text in the footer', async () => {
    const { LegalAcceptanceGate } = await import('./LegalAcceptanceGate');
    render(<LegalAcceptanceGate {...defaultProps} />);

    expect(
      screen.getByText(
        'By clicking Accept, you confirm you have read and agree to the documents listed above.'
      )
    ).toBeInTheDocument();
  });

  it('document read links open in a new tab', async () => {
    const { LegalAcceptanceGate } = await import('./LegalAcceptanceGate');
    render(<LegalAcceptanceGate {...defaultProps} />);

    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
    links.forEach((link) => {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    });
  });

  it('community_guidelines doc type renders a link to /community-guidelines', async () => {
    const { LegalAcceptanceGate } = await import('./LegalAcceptanceGate');
    render(<LegalAcceptanceGate {...defaultProps} pendingDocs={[makeDoc({ document_type: 'community_guidelines' })]} />);

    const links = screen.getAllByRole('link');
    const cgLink = links.find((l) => l.getAttribute('href')?.includes('community-guidelines'));
    expect(cgLink).toBeDefined();
  });
});
