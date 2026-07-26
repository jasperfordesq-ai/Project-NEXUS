// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

// The auth value must be a STABLE object across renders, exactly like the real
// AuthContext provides. MyVereinInvitationsPage's `load` is a useCallback keyed on
// `user`; a factory that returns a fresh literal per call gives it a new identity
// on every render, so the load effect re-fires forever and the page flip-flops
// between the spinner and a half-built Tabs collection.
const mockAuth = {
  user: { id: 7, name: 'Jane Member' },
  isAuthenticated: true,
  login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(),
  status: 'idle' as const, error: null,
};

vi.mock('@/contexts', () => createMockContexts({
  useAuth: () => mockAuth,
  useToast: () => mockToast,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import MyVereinInvitationsPage from './MyVereinInvitationsPage';
import { api } from '@/lib/api';

const MOCK_INVITATION = {
  id: 1,
  status: 'sent',
  message: 'Join our Verein!',
  sent_at: '2026-01-01T10:00:00Z',
  responded_at: null,
  expires_at: '2026-12-31T00:00:00Z',
  source_organization_id: 10,
  target_organization_id: 20,
  source_name: 'Source Verein',
  target_name: 'Target Verein',
  inviter_name: 'Alice Admin',
  invitee_user_id: 7,
};

/**
 * The page imports Tab/Tabs from '@/components/ui/Tabs' by direct path, so it always
 * rendered the REAL HeroUI v3 Tabs. Two consequences, both confirmed by dumping the
 * live DOM (and by .heroui-docs/react/components/(navigation)/tabs.mdx — selected tab
 * is `[aria-selected="true"]`, panel content lives in `.tabs__panel`):
 *
 *  1. Only the SELECTED panel is mounted — there is no `role="tabpanel"` for "Sent".
 *  2. React Aria selects the first tab one commit AFTER the tablist paints. At the
 *     instant `getByRole('tablist')` first succeeds, both tabs are still
 *     `aria-selected="false"` and NO panel exists at all.
 *
 * So "inside the received tab" has to be resolved through the real Received tab and
 * the panel it controls, not asserted globally the moment the tablist appears.
 */
function panelFor(tab: HTMLElement): HTMLElement | null {
  const id = tab.getAttribute('aria-controls');
  return id ? document.getElementById(id) : null;
}

async function receivedPanel(): Promise<HTMLElement> {
  const tab = await screen.findByRole('tab', { name: 'Received' });
  await waitFor(() => {
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(panelFor(tab)).not.toBeNull();
  });
  const panel = panelFor(tab);
  if (!panel) throw new Error('Received tab is selected but controls no panel');
  expect(panel).toHaveAttribute('role', 'tabpanel');
  return panel;
}

describe('MyVereinInvitationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading spinner while fetching invitations', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<MyVereinInvitationsPage />);
    // Spinner has aria-busy="true"
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    // ...and the tab strip is genuinely not rendered yet.
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('renders the tabs panel after data loads', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [MOCK_INVITATION] });
    render(<MyVereinInvitationsPage />);

    // Both real tab triggers render with their translated labels...
    expect(await screen.findByRole('tab', { name: 'Received' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Sent' })).toBeInTheDocument();
    // ...and the selected tab's panel is actually mounted (the thing this test names).
    expect(await receivedPanel()).toBeInTheDocument();
  });

  it('renders received invitation target name inside the received tab', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [MOCK_INVITATION] });
    render(<MyVereinInvitationsPage />);

    // Full rendered line is "<target_label>: <target_name>" — assert the whole thing
    // inside the Received panel, so a target name leaking into the Sent panel or
    // losing its label would fail.
    const panel = await receivedPanel();
    expect(within(panel).getByText('Club: Target Verein')).toBeInTheDocument();
  });

  it('renders the invitation message when present', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [MOCK_INVITATION] });
    render(<MyVereinInvitationsPage />);

    const panel = await receivedPanel();
    expect(within(panel).getByText('Join our Verein!')).toBeInTheDocument();
  });

  it('shows accept and decline buttons for a pending (sent) invitation', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [MOCK_INVITATION] });
    render(<MyVereinInvitationsPage />);

    const panel = await receivedPanel();
    // The "pending (sent)" precondition really is on screen (status_sent -> "Pending").
    expect(within(panel).getByText('Pending')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Decline' })).toBeInTheDocument();
  });

  it('does not show accept/decline for an already-accepted invitation', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [{ ...MOCK_INVITATION, status: 'accepted' }],
    });
    render(<MyVereinInvitationsPage />);

    const panel = await receivedPanel();
    // Prove the accepted invitation really rendered (status_accepted -> "Accepted")
    // before asserting the absence — otherwise this passes on an empty panel.
    expect(within(panel).getByText('Accepted')).toBeInTheDocument();

    expect(within(panel).queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /decline/i })).not.toBeInTheDocument();
  });

  it('calls POST respond endpoint when accept is clicked', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [MOCK_INVITATION] });
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { ...MOCK_INVITATION, status: 'accepted' } });

    render(<MyVereinInvitationsPage />);
    const panel = await receivedPanel();

    fireEvent.click(within(panel).getByRole('button', { name: 'Accept' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/v2/me/verein-invitations/1/respond',
        { action: 'accept' },
      );
    });
  });

  it('calls POST respond endpoint when decline is clicked', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [MOCK_INVITATION] });
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { ...MOCK_INVITATION, status: 'declined' } });

    render(<MyVereinInvitationsPage />);
    const panel = await receivedPanel();

    fireEvent.click(within(panel).getByRole('button', { name: 'Decline' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/v2/me/verein-invitations/1/respond',
        { action: 'decline' },
      );
    });
  });

  it('shows an error toast when the API fails to load', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));
    render(<MyVereinInvitationsPage />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows an error toast when the load returns success:false (not just on a throw)', async () => {
    // Regression: load() gated on `if (res.success && Array.isArray(res.data))` with no
    // else, and the catch only fires on a thrown error. A { success:false } (4xx, which
    // api.get resolves without throwing) used to show the empty "Received" tab silently,
    // indistinguishable from genuinely having no invitations. It must now surface the
    // error. Verified live.
    vi.mocked(api.get).mockResolvedValue({ success: false, error: 'Cannot load' });
    render(<MyVereinInvitationsPage />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows an error toast when respond API fails with a message', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [MOCK_INVITATION] });
    vi.mocked(api.post).mockResolvedValue({ success: false, error: 'Already responded' });

    render(<MyVereinInvitationsPage />);
    const panel = await receivedPanel();

    fireEvent.click(within(panel).getByRole('button', { name: 'Accept' }));

    // "with a message" — the server's own error text is surfaced, not the generic fallback.
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Already responded');
    });
  });

  it('shows empty tab content when there are no invitations', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<MyVereinInvitationsPage />);

    // The real empty-state copy (received_empty) inside the Received panel.
    const panel = await receivedPanel();
    expect(within(panel).getByText('You have no club invitations.')).toBeInTheDocument();
  });
});
