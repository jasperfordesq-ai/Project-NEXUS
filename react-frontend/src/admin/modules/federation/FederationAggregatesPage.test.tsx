// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── Hoisted mock refs ────────────────────────────────────────────────────────

const { mockAdminFederation, mockToast } = vi.hoisted(() => ({
  mockAdminFederation: {
    getAggregateConsent: vi.fn(),
    updateAggregateConsent: vi.fn(),
    rotateAggregateSecret: vi.fn(),
    getAggregateAuditLog: vi.fn(),
    getAggregatePreview: vi.fn(),
  },
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/admin/api/adminApi', () => ({
  adminFederation: mockAdminFederation,
}));

vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast })
);

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock('../../components', () => ({
  PageHeader: ({ title, description }: { title: string; description: string }) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  ),
}));

vi.mock('./PartnerTimebankGuidance', () => ({
  PartnerTimebankGuidance: () => <div data-testid="partner-guidance" />,
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const consentEnabled = { enabled: true, has_secret: true, last_rotated_at: '2024-06-01T12:00:00Z' };
const consentDisabled = { enabled: false, has_secret: false, last_rotated_at: null };

// unwrapData handles { data: T } directly
const wrap = <T,>(data: T) => ({ data });

// ── Import after mocks ────────────────────────────────────────────────────────

import FederationAggregatesPage from './FederationAggregatesPage';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Open the signing-key rotation confirmation and confirm it.
 *
 * 🔴 Two faults lived here. (1) The trigger was hunted with
 * `.find(b => text.includes('rotate') || text.includes('secret'))`, but the
 * button's copy is t('federation_aggregates.actions.rotate_secret') = "Replace
 * signing key" — neither word appears in it, so the search returned undefined.
 * (2) The click was then wrapped in `if (rotateBtn)`, which turned that miss into
 * a silent no-op: the confirmation never opened, and the failure surfaced one
 * line later as a missing "Replace key" button. Query the trigger by its real
 * accessible name and let a miss throw.
 *
 * The confirmation button is looked up by ConfirmModal's stable data-testid, not
 * by its label — callers override `confirmLabel`, so the label is not the
 * modal's own and text lookups on it rot.
 */
async function clickRotateAndConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /replace signing key/i }));
  await user.click(await screen.findByTestId('confirm-modal-confirm'));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FederationAggregatesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminFederation.getAggregateConsent.mockResolvedValue(wrap(consentDisabled));
  });

  it('shows loading spinner while fetching consent', () => {
    mockAdminFederation.getAggregateConsent.mockReturnValue(new Promise(() => {}));
    render(<FederationAggregatesPage />);

    const busyEl = screen
      .getAllByRole('status')
      .find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busyEl).toBeTruthy();
  });

  it('renders the consent panel once loaded (no spinner)', async () => {
    render(<FederationAggregatesPage />);

    await waitFor(() => {
      const busyEl = screen
        .queryAllByRole('status')
        .find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busyEl).toBeUndefined();
    });
  });

  it('renders a Switch for toggling the aggregate feed', async () => {
    render(<FederationAggregatesPage />);

    await waitFor(() => {
      expect(screen.queryAllByRole('switch').length).toBeGreaterThan(0);
    });
  });

  it('Switch is unchecked when consent is disabled', async () => {
    render(<FederationAggregatesPage />);

    await waitFor(() => {
      const sw = screen.queryAllByRole('switch')[0] as HTMLInputElement | undefined;
      expect(sw).toBeTruthy();
      // React Aria Switch renders role="switch" on the <input> element;
      // its checked property reflects isSelected.
      expect(sw?.checked).toBe(false);
    });
  });

  it('Switch is checked when consent is enabled', async () => {
    mockAdminFederation.getAggregateConsent.mockResolvedValueOnce(wrap(consentEnabled));
    render(<FederationAggregatesPage />);

    await waitFor(() => {
      const sw = screen.queryAllByRole('switch')[0] as HTMLInputElement | undefined;
      expect(sw).toBeTruthy();
      expect(sw?.checked).toBe(true);
    });
  });

  it('calls updateAggregateConsent when toggle is pressed', async () => {
    const user = userEvent.setup();
    mockAdminFederation.updateAggregateConsent.mockResolvedValueOnce(
      wrap(consentEnabled)
    );

    render(<FederationAggregatesPage />);

    await waitFor(() => {
      expect(screen.queryAllByRole('switch').length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => {
      expect(mockAdminFederation.updateAggregateConsent).toHaveBeenCalledWith(
        expect.any(Boolean)
      );
    });
  });

  it('shows success toast after enabling', async () => {
    const user = userEvent.setup();
    mockAdminFederation.updateAggregateConsent.mockResolvedValueOnce(wrap(consentEnabled));

    render(<FederationAggregatesPage />);

    await waitFor(() => {
      expect(screen.queryAllByRole('switch').length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows error toast when consent load fails', async () => {
    mockAdminFederation.getAggregateConsent.mockRejectedValueOnce(new Error('Network'));
    render(<FederationAggregatesPage />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('calls rotateAggregateSecret when Rotate Secret button is pressed', async () => {
    const user = userEvent.setup();
    mockAdminFederation.rotateAggregateSecret.mockResolvedValueOnce(
      wrap({ rotated: true, consent: consentEnabled })
    );

    render(<FederationAggregatesPage />);

    await waitFor(() => {
      expect(screen.queryAllByRole('switch').length).toBeGreaterThan(0);
    });

    await clickRotateAndConfirm(user);

    await waitFor(() => {
      expect(mockAdminFederation.rotateAggregateSecret).toHaveBeenCalled();
    });
  });

  it('shows success toast after rotating secret', async () => {
    const user = userEvent.setup();
    mockAdminFederation.rotateAggregateSecret.mockResolvedValueOnce(
      wrap({ rotated: true, consent: consentEnabled })
    );

    render(<FederationAggregatesPage />);

    await waitFor(() => {
      expect(screen.queryAllByRole('switch').length).toBeGreaterThan(0);
    });

    await clickRotateAndConfirm(user);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('opens audit log modal and calls getAggregateAuditLog', async () => {
    const user = userEvent.setup();
    mockAdminFederation.getAggregateAuditLog.mockResolvedValueOnce(
      wrap({ entries: [] })
    );

    render(<FederationAggregatesPage />);

    await waitFor(() => {
      expect(screen.queryAllByRole('switch').length).toBeGreaterThan(0);
    });

    const auditBtn = screen
      .getAllByRole('button')
      .find((b) => b.textContent?.toLowerCase().includes('audit'));
    if (auditBtn) await user.click(auditBtn);

    await waitFor(() => {
      expect(mockAdminFederation.getAggregateAuditLog).toHaveBeenCalled();
    });
  });

  it('opens preview modal and calls getAggregatePreview', async () => {
    const user = userEvent.setup();
    mockAdminFederation.getAggregatePreview.mockResolvedValueOnce(
      wrap({ payload: { members: 10 }, algorithm: 'HMAC-SHA256' })
    );

    render(<FederationAggregatesPage />);

    await waitFor(() => {
      expect(screen.queryAllByRole('switch').length).toBeGreaterThan(0);
    });

    const previewBtn = screen
      .getAllByRole('button')
      .find((b) => b.textContent?.toLowerCase().includes('preview'));
    if (previewBtn) await user.click(previewBtn);

    await waitFor(() => {
      expect(mockAdminFederation.getAggregatePreview).toHaveBeenCalled();
    });
  });

  it('shows error toast when rotate fails', async () => {
    const user = userEvent.setup();
    mockAdminFederation.rotateAggregateSecret.mockRejectedValueOnce(new Error('fail'));

    render(<FederationAggregatesPage />);

    await waitFor(() => {
      expect(screen.queryAllByRole('switch').length).toBeGreaterThan(0);
    });

    await clickRotateAndConfirm(user);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows error toast when updateAggregateConsent fails', async () => {
    const user = userEvent.setup();
    mockAdminFederation.updateAggregateConsent.mockRejectedValueOnce(new Error('fail'));

    render(<FederationAggregatesPage />);

    await waitFor(() => {
      expect(screen.queryAllByRole('switch').length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });
});
