// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for SessionExpiredModal
 *
 * SessionExpiredModal imports `useAuth` from '@/contexts/AuthContext' and
 * `useTenant` from '@/contexts/TenantContext' — both DIRECT paths. Vitest
 * resolves mocks per specifier, so the old '@/contexts' barrel mock was never
 * consulted and both real provider-backed hooks threw, killing every test in
 * the file before the modal could render.
 *
 * The mocks are deliberately total (no importOriginal): the real AuthContext
 * and TenantContext modules both import '@/i18n', which unconditionally
 * re-initialises i18next with the HTTP/localStorage backends and would wipe the
 * English locale resources src/test/setup.ts preloads — the assertions below
 * are on real English copy. No production module in this render graph imports
 * the '@/contexts' barrel, so nothing needs the other exports.
 *
 * The Modal itself is the real @/components/ui one, rendering into a portal.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, within } from '@/test/test-utils';
import { SessionExpiredModal } from './SessionExpiredModal';

vi.mock('@/lib/api', () => ({
  SESSION_EXPIRED_EVENT: 'nexus:session_expired',
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  tokenManager: { getTenantId: vi.fn(), getAccessToken: vi.fn() },
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: { id: 2, name: 'Test', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: () => true,
    hasModule: () => true,
    isLoading: false,
    branding: { name: 'Test', primary_color: '#4F46E5' },
    tenantSlug: 'test',
  }),
}));

// status: 'authenticated' matters — the modal only opens for a session that was
// live, so a stale token on a first visit stays silent (see wasAuthenticated).
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, name: 'Test User' },
    isAuthenticated: true,
    status: 'authenticated',
    error: null,
  }),
}));

describe('SessionExpiredModal', () => {
  it('renders without crashing (modal initially hidden)', () => {
    const { container } = render(<SessionExpiredModal />);
    expect(container).toBeInTheDocument();
  });

  it('does not show modal content by default', () => {
    render(<SessionExpiredModal />);
    expect(screen.queryByText('Session expired')).not.toBeInTheDocument();
  });

  it('shows modal when session expired event fires', () => {
    render(<SessionExpiredModal />);
    act(() => {
      window.dispatchEvent(new CustomEvent('nexus:session_expired'));
    });
    // errors.session_expired / errors.session_expired_message — real English copy.
    // Asserted through the dialog + heading roles now that the real HeroUI Modal
    // renders, so the copy has to land in an actual labelled dialog.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Session expired' })).toBeInTheDocument();
    expect(screen.getByText(/session has expired/i)).toBeInTheDocument();
  });

  it('shows Dismiss and Log In buttons when modal is open', () => {
    render(<SessionExpiredModal />);
    act(() => {
      window.dispatchEvent(new CustomEvent('nexus:session_expired'));
    });
    // errors.dismiss / common.auth.log_in — asserted as real buttons in the
    // modal footer rather than as bare text nodes. Scoped to the footer because
    // React Aria's overlay also renders a hidden 1x1 sentinel button labelled
    // "Dismiss" for screen-reader dismissal.
    const footer = screen.getByText('Dismiss').closest('[data-slot="modal-footer"]');
    expect(footer).not.toBeNull();
    expect(within(footer as HTMLElement).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    expect(within(footer as HTMLElement).getByRole('button', { name: 'Log In' })).toBeInTheDocument();
  });
});
