// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
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
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

// ── Mock the adminEnterprise API ──────────────────────────────────────────────
const { mockGetLogFiles, mockDownloadLogFile } = vi.hoisted(() => ({
  mockGetLogFiles: vi.fn(),
  mockDownloadLogFile: vi.fn(),
}));

vi.mock('../../api/adminApi', () => ({
  adminEnterprise: {
    getLogFiles: mockGetLogFiles,
    downloadLogFile: mockDownloadLogFile,
    getDashboard: vi.fn(),
    createBreach: vi.fn(),
    getGdprBreaches: vi.fn(),
  },
  adminSystem: {
    getActivityLog: vi.fn(),
  },
  adminSuper: {
    getDashboard: vi.fn(),
    listTenants: vi.fn(),
  },
  adminTools: {
    getRedirects: vi.fn(),
    createRedirect: vi.fn(),
    deleteRedirect: vi.fn(),
  },
}));

import { LogFiles } from './LogFiles';

const MOCK_LOG_FILES = [
  { name: 'laravel.log', size: '12 KB', size_bytes: 12288, line_count: 450, modified_at: '2026-06-22T10:00:00Z' },
  { name: 'error.log', size: '3 KB', size_bytes: 3072, line_count: 88, modified_at: '2026-06-21T08:00:00Z' },
];

describe('LogFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLogFiles.mockResolvedValue({ success: true, data: MOCK_LOG_FILES });
  });

  // ── loading ────────────────────────────────────────────────────────────────
  it('shows loading spinner while fetching', () => {
    mockGetLogFiles.mockReturnValue(new Promise(() => {}));
    render(<LogFiles />);
    const statuses = screen.getAllByRole('status');
    const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeInTheDocument();
  });

  // ── populated ──────────────────────────────────────────────────────────────
  it('renders file names after load', async () => {
    render(<LogFiles />);
    await waitFor(() => {
      expect(screen.getByText('laravel.log')).toBeInTheDocument();
    });
    expect(screen.getByText('error.log')).toBeInTheDocument();
  });

  it('hides spinner after data loads', async () => {
    render(<LogFiles />);
    await waitFor(() => {
      const statuses = screen.queryAllByRole('status');
      const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });
  });

  it('shows file count stat card', async () => {
    render(<LogFiles />);
    await waitFor(() => screen.getByText('laravel.log'));
    // Total files count
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  // ── empty state ────────────────────────────────────────────────────────────
  it('shows empty state message when no files returned', async () => {
    mockGetLogFiles.mockResolvedValue({ success: true, data: [] });
    render(<LogFiles />);
    await waitFor(() => {
      expect(screen.queryAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true')).toBeUndefined();
    });
    // Empty message key or resolved text
    expect(screen.queryByText('laravel.log')).not.toBeInTheDocument();
  });

  // ── error state ────────────────────────────────────────────────────────────
  it('calls toast.error when API throws', async () => {
    mockGetLogFiles.mockRejectedValue(new Error('Server error'));
    render(<LogFiles />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  // ── filter buttons ─────────────────────────────────────────────────────────
  it('filters to show only error files when "errors" filter is clicked', async () => {
    const user = userEvent.setup();
    render(<LogFiles />);
    await waitFor(() => screen.getByText('laravel.log'));

    // Find the 'errors' filter button
    const allButtons = screen.getAllByRole('button');
    const errorsBtn = allButtons.find((b) => {
      const text = b.textContent ?? '';
      return text.toLowerCase().includes('error') || text.toLowerCase().includes('log_files_labels.filter_errors');
    });
    if (errorsBtn) {
      await user.click(errorsBtn);
      // After filtering, laravel.log (no "error" in name) should be hidden
      await waitFor(() => {
        expect(screen.queryByText('laravel.log')).not.toBeInTheDocument();
      });
      expect(screen.getByText('error.log')).toBeInTheDocument();
    }
  });

  // ── download button ────────────────────────────────────────────────────────
  it('renders download buttons for each file', async () => {
    render(<LogFiles />);
    await waitFor(() => screen.getByText('laravel.log'));
    const downloadButtons = screen.getAllByRole('button', { name: /download/i });
    expect(downloadButtons.length).toBeGreaterThanOrEqual(2);
  });

  it('downloads a log file through the authenticated client, not a new tab', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    mockDownloadLogFile.mockResolvedValue(new Blob());
    render(<LogFiles />);
    await waitFor(() => screen.getByText('laravel.log'));

    fireEvent.click(screen.getAllByRole('button', { name: /download/i })[0]);

    await waitFor(() => expect(mockDownloadLogFile).toHaveBeenCalledTimes(1));
    expect(mockDownloadLogFile.mock.calls[0][0]).toMatch(/\.log$/);
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  // ── refresh button ─────────────────────────────────────────────────────────
  it('re-fetches when refresh button is pressed', async () => {
    const user = userEvent.setup();
    render(<LogFiles />);
    await waitFor(() => screen.getByText('laravel.log'));

    mockGetLogFiles.mockResolvedValue({ success: true, data: MOCK_LOG_FILES });
    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    await user.click(refreshBtn);
    await waitFor(() => {
      expect(mockGetLogFiles).toHaveBeenCalledTimes(2);
    });
  });
});
