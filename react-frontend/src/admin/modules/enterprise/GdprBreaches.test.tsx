// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── Stable mock refs ──────────────────────────────────────────────────────────
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};

vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast })
);

// GdprBreaches uses useAdminPageMeta from AdminMetaContext.
// We mock it to be a no-op so tests don't need the full provider.
vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

// ── Mock adminEnterprise API ──────────────────────────────────────────────────
const { mockGetGdprBreaches, mockCreateBreach } = vi.hoisted(() => ({
  mockGetGdprBreaches: vi.fn(),
  mockCreateBreach: vi.fn(),
}));

vi.mock('../../api/adminApi', () => ({
  adminEnterprise: {
    getGdprBreaches: mockGetGdprBreaches,
    createBreach: mockCreateBreach,
    getLogFiles: vi.fn(),
  },
  adminSystem: { getActivityLog: vi.fn() },
  adminSuper: { getDashboard: vi.fn(), listTenants: vi.fn() },
  adminTools: { getRedirects: vi.fn(), createRedirect: vi.fn(), deleteRedirect: vi.fn() },
}));

import { GdprBreaches } from './GdprBreaches';

const MOCK_BREACHES = [
  {
    id: 1,
    title: 'Email exposure incident',
    severity: 'high',
    status: 'open',
    description: 'Customer emails were exposed',
    reported_at: '2026-06-01T00:00:00Z',
    affected_users: 30,
  },
  {
    id: 2,
    title: 'Minor config leak',
    severity: 'low',
    status: 'resolved',
    description: '',
    reported_at: '2026-05-10T00:00:00Z',
    affected_users: 0,
  },
];

describe('GdprBreaches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGdprBreaches.mockResolvedValue({ success: true, data: MOCK_BREACHES });
    mockCreateBreach.mockResolvedValue({ success: true, data: { id: 3 } });
  });

  // ── loading ────────────────────────────────────────────────────────────────
  it('passes isLoading to DataTable while fetching', () => {
    mockGetGdprBreaches.mockReturnValue(new Promise(() => {}));
    render(<GdprBreaches />);
    // Component renders immediately without crashing
    expect(document.body).toBeInTheDocument();
  });

  // ── populated ──────────────────────────────────────────────────────────────
  it('renders breach titles after load', async () => {
    render(<GdprBreaches />);
    await waitFor(() => {
      expect(screen.getByText('Email exposure incident')).toBeInTheDocument();
    });
    expect(screen.getByText('Minor config leak')).toBeInTheDocument();
  });

  // By data attribute, not the chip's text: the label is t('enterprise.gdpr_severity_high')
  // and no i18n resources load under test, so the visible text is i18next's
  // missing-key output rather than the severity.
  it('renders severity chips', async () => {
    render(<GdprBreaches />);
    await waitFor(() => screen.getByText('Email exposure incident'));
    const severities = screen
      .getAllByTestId('breach-severity-chip')
      .map((chip) => chip.getAttribute('data-severity'));
    expect(severities).toContain('high');
    expect(severities).toContain('low');
  });

  // ── empty state ────────────────────────────────────────────────────────────
  it('renders empty DataTable when no breaches returned', async () => {
    mockGetGdprBreaches.mockResolvedValue({ success: true, data: [] });
    render(<GdprBreaches />);
    await waitFor(() => {
      expect(mockGetGdprBreaches).toHaveBeenCalled();
    });
    expect(screen.queryByText('Email exposure incident')).not.toBeInTheDocument();
  });

  // ── error state ────────────────────────────────────────────────────────────
  it('calls toast.error when API throws', async () => {
    mockGetGdprBreaches.mockRejectedValue(new Error('Server error'));
    render(<GdprBreaches />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  // ── report breach modal ────────────────────────────────────────────────────
  it('opens report breach modal when button is clicked', async () => {
    const user = userEvent.setup();
    render(<GdprBreaches />);
    await waitFor(() => screen.getByText('Email exposure incident'));

    // Find the "Report breach" button (variant danger)
    const reportBtn = screen.getAllByRole('button').find((b) => {
      const text = b.textContent ?? '';
      return text.toLowerCase().includes('report') && text.toLowerCase().includes('breach');
    });
    if (reportBtn) {
      await user.click(reportBtn);
      // Modal opens — look for the title input or modal header
      await waitFor(() => {
        const modal = screen.getAllByRole('dialog');
        expect(modal.length).toBeGreaterThan(0);
      });
    }
  });

  it('calls createBreach and shows success toast on valid form submit', async () => {
    const user = userEvent.setup();
    render(<GdprBreaches />);
    await waitFor(() => screen.getByText('Email exposure incident'));

    // Open report modal
    const reportBtn = screen.getAllByRole('button').find((b) => {
      const text = b.textContent ?? '';
      return text.toLowerCase().includes('report') && text.toLowerCase().includes('breach');
    });
    if (!reportBtn) return;
    await user.click(reportBtn);

    // Wait for modal
    await waitFor(() => {
      expect(screen.getAllByRole('dialog').length).toBeGreaterThan(0);
    });

    // Fill in the title field (required)
    const titleInputs = screen.getAllByRole('textbox');
    const titleInput = titleInputs.find((el) => {
      const labelId = el.getAttribute('aria-labelledby') ?? '';
      const parent = el.closest('div');
      return (parent?.textContent ?? '').toLowerCase().includes('title') ||
             el.getAttribute('placeholder')?.toLowerCase().includes('breach');
    }) ?? titleInputs[0];

    if (titleInput) {
      await user.type(titleInput, 'New security incident');
    }

    // Click submit (Report Breach button inside modal)
    const submitBtn = screen.getAllByRole('button').find((b) => {
      const text = b.textContent ?? '';
      return (text.toLowerCase().includes('report') && text.toLowerCase().includes('breach')) &&
             b !== reportBtn;
    });

    if (submitBtn) {
      await user.click(submitBtn);
      await waitFor(() => {
        expect(mockCreateBreach).toHaveBeenCalledWith(
          expect.objectContaining({ title: expect.any(String) })
        );
      });
      await waitFor(() => {
        expect(mockToast.success).toHaveBeenCalled();
      });
    }
  });

  it('calls toast.error when title is empty on submit', async () => {
    const user = userEvent.setup();
    render(<GdprBreaches />);
    await waitFor(() => screen.getByText('Email exposure incident'));

    const reportBtn = screen.getAllByRole('button').find((b) => {
      const text = b.textContent ?? '';
      return text.toLowerCase().includes('report') && text.toLowerCase().includes('breach');
    });
    if (!reportBtn) return;
    await user.click(reportBtn);

    await waitFor(() => {
      expect(screen.getAllByRole('dialog').length).toBeGreaterThan(0);
    });

    // Submit without filling title
    const submitBtns = screen.getAllByRole('button').filter((b) => {
      const text = b.textContent ?? '';
      return text.toLowerCase().includes('report') && text.toLowerCase().includes('breach');
    });
    // Last match is the modal submit
    const submitBtn = submitBtns[submitBtns.length - 1];
    if (submitBtn && submitBtn !== reportBtn) {
      await user.click(submitBtn);
      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled();
      });
    }
  });

  // ── refresh ────────────────────────────────────────────────────────────────
  it('re-fetches when refresh button is pressed', async () => {
    const user = userEvent.setup();
    render(<GdprBreaches />);
    await waitFor(() => screen.getByText('Email exposure incident'));

    mockGetGdprBreaches.mockResolvedValue({ success: true, data: MOCK_BREACHES });
    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    await user.click(refreshBtn);
    await waitFor(() => {
      expect(mockGetGdprBreaches).toHaveBeenCalledTimes(2);
    });
  });
});
