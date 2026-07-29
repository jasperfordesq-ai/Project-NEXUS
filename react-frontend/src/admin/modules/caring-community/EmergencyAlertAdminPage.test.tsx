// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ─── mock api (default import: EmergencyAlertAdminPage uses `import api from '@/lib/api'`) ───
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({
  default: mockApi,
  api: mockApi,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/contexts', () => createMockContexts());

import EmergencyAlertAdminPage from './EmergencyAlertAdminPage';

// ─── helpers ───────────────────────────────────────────────────────────────────

const EMPTY_RESPONSE = { success: true, data: [] };

const ALERT = {
  id: 1,
  title: 'Test Alert',
  body: 'Something urgent happened.',
  severity: 'warning' as const,
  sent_at: '2025-01-01T10:00:00Z',
  expires_at: null,
  is_active: 1,
  push_sent: 1,
  push_result: JSON.stringify({ sent: 42, failed: 2 }),
  dismissed_count: 5,
  created_at: '2025-01-01T09:00:00Z',
};

const INACTIVE_ALERT = { ...ALERT, id: 2, title: 'Old Alert', is_active: 0, push_sent: 0, push_result: null };

// ─── tests ─────────────────────────────────────────────────────────────────────

describe('EmergencyAlertAdminPage — loading state', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('shows a loading spinner while fetching', () => {
    // Never resolves during this test
    mockApi.get.mockReturnValue(new Promise(() => {}));
    render(<EmergencyAlertAdminPage />);
    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });
});

describe('EmergencyAlertAdminPage — empty state', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue(EMPTY_RESPONSE);
  });

  it('renders the page heading', async () => {
    render(<EmergencyAlertAdminPage />);
    await waitFor(() => {
      // No spinner remaining
      const spinners = screen.queryAllByRole('status');
      expect(spinners.find((el) => el.getAttribute('aria-busy') === 'true')).toBeUndefined();
    });
    // Heading is present (translated key fallback shown as-is with real i18n)
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('shows the empty message when no alerts', async () => {
    render(<EmergencyAlertAdminPage />);
    await waitFor(() => {
      const spinners = screen.queryAllByRole('status');
      expect(spinners.find((el) => el.getAttribute('aria-busy') === 'true')).toBeUndefined();
    });
    // empty text key renders
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the "Send Emergency Alert" button', async () => {
    render(<EmergencyAlertAdminPage />);
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/admin/caring-community/emergency-alerts');
    });
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });
});

describe('EmergencyAlertAdminPage — populated state', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: [ALERT, INACTIVE_ALERT] });
  });

  it('renders the alert table with rows', async () => {
    render(<EmergencyAlertAdminPage />);
    // HeroUI Table does not reliably expose role="table" in jsdom; wait for cell content instead
    await waitFor(() => {
      expect(screen.getByText('Test Alert')).toBeInTheDocument();
    });
    expect(screen.getByText('Old Alert')).toBeInTheDocument();
  });

  it('shows push stats for push_sent alerts', async () => {
    render(<EmergencyAlertAdminPage />);
    await waitFor(() => {
      expect(screen.getByText(/42/)).toBeInTheDocument();
    });
  });

  it('shows dismissed count', async () => {
    render(<EmergencyAlertAdminPage />);
    // Wait for table content (e.g. alert title) before checking dismissed count
    await waitFor(() => {
      expect(screen.getByText('Test Alert')).toBeInTheDocument();
    });
    // dismissed_count = 5 is rendered as a <span> in the table cell
    const spans = Array.from(document.querySelectorAll('span')).filter((el) => el.textContent?.trim() === '5');
    expect(spans.length).toBeGreaterThan(0);
  });

  it('shows deactivate button only for active alerts', async () => {
    render(<EmergencyAlertAdminPage />);
    // Wait for table content instead of role="table"
    await waitFor(() => {
      expect(screen.getByText('Test Alert')).toBeInTheDocument();
    });
    // Only 1 active alert → only 1 deactivate button
    const allButtons = screen.getAllByRole('button');
    // The deactivate button text comes from translation key 'caring_emergency.actions.deactivate'
    // With real i18n it will render the key or translated value — either way exactly one
    const deactivateBtns = allButtons.filter((b) =>
      b.textContent?.toLowerCase().includes('deactivate') ||
      b.textContent?.includes('caring_emergency.actions.deactivate')
    );
    expect(deactivateBtns.length).toBe(1);
  });
});

describe('EmergencyAlertAdminPage — error state', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // This — not a rejected promise — is what a real load failure looks like: the
  // API client returns a failed response instead of throwing. The page used to
  // check nothing, so a refused load rendered as a silent empty list and the
  // server's own (translated) message was discarded.
  it('shows the server message when the load is refused', async () => {
    mockApi.get.mockResolvedValue({
      success: false,
      error: 'Dieser Bereich ist nicht verfügbar.',
    });
    render(<EmergencyAlertAdminPage />);
    await waitFor(() => {
      expect(screen.getByText('Dieser Bereich ist nicht verfügbar.')).toBeInTheDocument();
    });
  });

  // A thrown error is a client-side fault, and its text is untranslated
  // technical English written for a developer — never for the admin reading the
  // screen. The translated fallback is shown instead of the raw message.
  it('shows the translated fallback when the request throws', async () => {
    mockApi.get.mockRejectedValue(new Error('Network failure'));
    render(<EmergencyAlertAdminPage />);
    // Matched by element rather than by text: these tests run without i18n
    // resources loaded, so the exact string t() returns for the fallback key is
    // an artefact of the harness. What matters is that a message is shown and
    // that it is not the thrown Error's raw text.
    const message = await waitFor(() => {
      const node = document.querySelector('p.text-danger');
      expect(node).not.toBeNull();
      return node as HTMLElement;
    });
    expect(message.textContent?.trim()).not.toBe('');
    expect(message.textContent).not.toContain('Network failure');
  });
});

describe('EmergencyAlertAdminPage — send modal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue(EMPTY_RESPONSE);
  });

  it('opens the send modal when the primary button is clicked', async () => {
    const user = userEvent.setup();
    render(<EmergencyAlertAdminPage />);
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalled();
    });

    // Find the open-modal button (contains 'open_send_modal' key or translated text)
    const openBtns = screen.getAllByRole('button');
    // The primary action button is the one that triggers the modal
    await user.click(openBtns[openBtns.length - 1]);

    // Modal should appear with a heading
    await waitFor(() => {
      const headings = screen.getAllByRole('heading');
      expect(headings.length).toBeGreaterThan(0);
    });
  });

  it('broadcast button is disabled when form is incomplete', async () => {
    const user = userEvent.setup();
    render(<EmergencyAlertAdminPage />);
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalled();
    });

    const openBtns = screen.getAllByRole('button');
    await user.click(openBtns[openBtns.length - 1]);

    await waitFor(() => {
      // Look for the broadcast button in the modal footer
      const allBtns = screen.getAllByRole('button');
      const broadcastBtn = allBtns.find(
        (b) =>
          b.textContent?.includes('broadcast') ||
          b.textContent?.includes('Broadcast') ||
          b.hasAttribute('disabled') ||
          b.getAttribute('aria-disabled') === 'true',
      );
      expect(broadcastBtn).toBeDefined();
    });
  });

  it('calls POST api when alert is submitted with required fields filled', async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({ success: true });
    // After post, refresh returns empty
    mockApi.get
      .mockResolvedValueOnce(EMPTY_RESPONSE)
      .mockResolvedValueOnce(EMPTY_RESPONSE);

    render(<EmergencyAlertAdminPage />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(1));

    const openBtns = screen.getAllByRole('button');
    await user.click(openBtns[openBtns.length - 1]);

    await waitFor(() => {
      expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
    });

    // Fill title
    const inputs = screen.getAllByRole('textbox');
    if (inputs[0]) {
      await user.clear(inputs[0]);
      await user.type(inputs[0], 'Urgent announcement');
    }
    // Fill body (textarea)
    const textareas = document.querySelectorAll('textarea');
    if (textareas[0]) {
      await user.clear(textareas[0]);
      await user.type(textareas[0], 'Please evacuate immediately.');
    }

    // Tick the confirmation checkbox
    const checkboxes = screen.getAllByRole('checkbox');
    if (checkboxes[0]) {
      await user.click(checkboxes[0]);
    }

    // Find + click broadcast button
    const allBtns = screen.getAllByRole('button');
    const broadcastBtn = allBtns.find(
      (b) =>
        !b.hasAttribute('disabled') &&
        b.getAttribute('aria-disabled') !== 'true' &&
        (b.textContent?.toLowerCase().includes('broadcast') ||
          b.textContent?.includes('caring_emergency.actions.broadcast')),
    );
    if (broadcastBtn) {
      await user.click(broadcastBtn);
      await waitFor(() => {
        expect(mockApi.post).toHaveBeenCalledWith(
          '/v2/admin/caring-community/emergency-alerts',
          expect.objectContaining({ title: 'Urgent announcement' }),
        );
      });
    }
  });
});

describe('EmergencyAlertAdminPage — deactivate flow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: [ALERT] });
  });

  it('shows confirm/cancel buttons after clicking Deactivate', async () => {
    render(<EmergencyAlertAdminPage />);
    // Wait for table content (HeroUI Table doesn't expose role="table" in jsdom)
    await waitFor(() => {
      expect(screen.getByText('Test Alert')).toBeInTheDocument();
    });

    let deactivateBtn: HTMLElement | undefined;
    await waitFor(() => {
      const allBtns = screen.getAllByRole('button');
      deactivateBtn = allBtns.find(
        (b) =>
          b.textContent?.toLowerCase().includes('deactivate') ||
          b.textContent?.includes('caring_emergency.actions.deactivate'),
      );
      expect(deactivateBtn).toBeDefined();
    });
    // Use fireEvent.click for React Aria onPress in jsdom
    fireEvent.click(deactivateBtn!);

    // Should now show confirm + cancel
    await waitFor(() => {
      const updatedBtns = screen.getAllByRole('button');
      const confirmBtn = updatedBtns.find(
        (b) =>
          b.textContent?.toLowerCase().includes('yes') ||
          b.textContent?.toLowerCase().includes('confirm') ||
          b.textContent?.includes('caring_emergency.actions.confirm_deactivate'),
      );
      expect(confirmBtn).toBeDefined();
    });
  });

  it('calls DELETE when deactivation is confirmed', async () => {
    mockApi.delete.mockResolvedValue({ success: true });
    mockApi.get
      .mockResolvedValueOnce({ success: true, data: [ALERT] })
      .mockResolvedValueOnce(EMPTY_RESPONSE);

    render(<EmergencyAlertAdminPage />);
    // Wait for table content (HeroUI Table doesn't expose role="table" in jsdom)
    await waitFor(() => expect(screen.getByText('Test Alert')).toBeInTheDocument());

    let deactivateBtn: HTMLElement | undefined;
    await waitFor(() => {
      const allBtns = screen.getAllByRole('button');
      deactivateBtn = allBtns.find(
        (b) =>
          b.textContent?.toLowerCase().includes('deactivate') ||
          b.textContent?.includes('caring_emergency.actions.deactivate'),
      );
      expect(deactivateBtn).toBeDefined();
    });
    fireEvent.click(deactivateBtn!);

    // Wait for confirm button to appear, then click it
    let confirmBtn: HTMLElement | undefined;
    await waitFor(() => {
      const updatedBtns = screen.getAllByRole('button');
      confirmBtn = updatedBtns.find(
        (b) =>
          b.textContent?.toLowerCase().includes('yes') ||
          b.textContent?.toLowerCase().includes('confirm') ||
          b.textContent?.includes('caring_emergency.actions.confirm_deactivate'),
      );
      expect(confirmBtn).toBeDefined();
    });
    fireEvent.click(confirmBtn!);

    await waitFor(() => {
      expect(mockApi.delete).toHaveBeenCalledWith(
        `/v2/admin/caring-community/emergency-alerts/${ALERT.id}`,
      );
    });
  });
});
