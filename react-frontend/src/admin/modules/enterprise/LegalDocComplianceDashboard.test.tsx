// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

const mockGetComplianceStats = vi.hoisted(() => vi.fn());
const mockGetAcceptances = vi.hoisted(() => vi.fn());
const mockExportAcceptances = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/ToastContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/ToastContext')>();
  return { ...actual, useToast: () => mockToast };
});
vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast }),
);

vi.mock('@/admin/api/adminApi', () => ({
  adminLegalDocs: {
    getComplianceStats: mockGetComplianceStats,
    getAcceptances: mockGetAcceptances,
    exportAcceptances: mockExportAcceptances,
  },
  adminNewsletters: {},
  adminHelpFaqs: {},
}));

vi.mock('../../AdminMetaContext', () => ({ useAdminPageMeta: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import LegalDocComplianceDashboard from './LegalDocComplianceDashboard';

const makeStats = (overrides = {}) => ({
  total_users: 500,
  users_pending_acceptance: 25,
  overall_compliance_rate: 95.0,
  documents: [],
  ...overrides,
});

const makeDoc = (overrides = {}) => ({
  id: 1,
  title: 'Terms of Service',
  document_type: 'terms',
  version_number: '1.0',
  effective_date: '2024-01-01T00:00:00Z',
  acceptance_rate: 95.0,
  users_accepted: 475,
  users_not_accepted: 25,
  current_version_id: 10,
  ...overrides,
});

describe('LegalDocComplianceDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Prevent URL.createObjectURL from throwing in jsdom
    global.URL.createObjectURL = vi.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('shows loading spinner while stats are fetching', async () => {
    mockGetComplianceStats.mockReturnValue(new Promise(() => {}));
    render(<LegalDocComplianceDashboard />);
    const busy = screen
      .getAllByRole('status')
      .find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('shows error state when stats fail to load', async () => {
    mockGetComplianceStats.mockResolvedValue({ success: false, error: 'Server error' });
    render(<LegalDocComplianceDashboard />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    // stats is null → error fallback renders
    await waitFor(() => {
      expect(screen.getByText(/failed.to.load/i)).toBeInTheDocument();
    });
  });

  // The compliance rate is rendered through formatPercentValue(), i.e. Intl
  // percent formatting for the active locale with maximumFractionDigits: 1 --
  // not the hand-rolled `toFixed(1) + '%'` this assertion was written against.
  // A whole number therefore has no trailing '.0'.
  it('renders stat cards with correct values', async () => {
    mockGetComplianceStats.mockResolvedValue({ success: true, data: makeStats() });
    render(<LegalDocComplianceDashboard />);
    await waitFor(() => {
      expect(screen.getByText('500')).toBeInTheDocument();
    });
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('95%')).toBeInTheDocument();
  });

  it('keeps one decimal place on a fractional compliance rate', async () => {
    mockGetComplianceStats.mockResolvedValue({
      success: true,
      data: makeStats({ overall_compliance_rate: 95.42 }),
    });
    render(<LegalDocComplianceDashboard />);
    await waitFor(() => {
      expect(screen.getByText('95.4%')).toBeInTheDocument();
    });
  });

  it('renders empty state when no documents are present', async () => {
    mockGetComplianceStats.mockResolvedValue({ success: true, data: makeStats() });
    render(<LegalDocComplianceDashboard />);
    await waitFor(() => {
      expect(screen.getByText(/no legal documents/i)).toBeInTheDocument();
    });
  });

  it('renders document row in the compliance table', async () => {
    mockGetComplianceStats.mockResolvedValue({
      success: true,
      data: makeStats({ documents: [makeDoc()] }),
    });
    render(<LegalDocComplianceDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Terms of Service')).toBeInTheDocument();
    });
    expect(screen.getByText('1.0')).toBeInTheDocument();
    // 475 may appear multiple times (stat card + table); just assert presence
    expect(screen.getAllByText('475').length).toBeGreaterThanOrEqual(1);
  });

  it('calls getAcceptances and opens modal when View button is clicked', async () => {
    mockGetComplianceStats.mockResolvedValue({
      success: true,
      data: makeStats({ documents: [makeDoc()] }),
    });
    mockGetAcceptances.mockResolvedValue({
      success: true,
      data: [
        {
          user_name: 'Alice Smith',
          user_email: 'alice@example.com',
          version_number: '1.0',
          accepted_at: '2024-01-15T10:00:00Z',
          acceptance_method: 'checkbox',
          ip_address: '1.2.3.4',
        },
      ],
    });

    const user = userEvent.setup();
    render(<LegalDocComplianceDashboard />);
    await waitFor(() => expect(screen.getByText('Terms of Service')).toBeInTheDocument());

    const viewBtn = screen.getByRole('button', { name: /view/i });
    await user.click(viewBtn);

    await waitFor(() => {
      expect(mockGetAcceptances).toHaveBeenCalledWith(10, 100, 0);
    });
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
  });

  it('shows no-acceptances message when modal data is empty', async () => {
    mockGetComplianceStats.mockResolvedValue({
      success: true,
      data: makeStats({ documents: [makeDoc()] }),
    });
    mockGetAcceptances.mockResolvedValue({ success: true, data: [] });

    const user = userEvent.setup();
    render(<LegalDocComplianceDashboard />);
    await waitFor(() => expect(screen.getByText('Terms of Service')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /view/i }));
    await waitFor(() => {
      expect(screen.getByText(/no acceptances found/i)).toBeInTheDocument();
    });
  });

  it('calls exportAcceptances and shows success toast on export', async () => {
    mockGetComplianceStats.mockResolvedValue({
      success: true,
      data: makeStats({ documents: [makeDoc()] }),
    });
    mockExportAcceptances.mockResolvedValue({
      success: true,
      data: 'user_name,email\nAlice,alice@example.com',
    });

    // Capture the real createElement before spying so we can delegate non-'a' tags
    const realCreateElement = document.createElement.bind(document);
    const mockAnchorClick = vi.fn();
    vi.spyOn(document, 'createElement').mockImplementation((tag, ...args) => {
      if (tag === 'a') {
        const a = realCreateElement(tag, ...args) as HTMLAnchorElement;
        // Override click so we don't attempt real navigation
        a.click = mockAnchorClick;
        return a;
      }
      return realCreateElement(tag, ...args);
    });

    const user = userEvent.setup();
    render(<LegalDocComplianceDashboard />);
    await waitFor(() => expect(screen.getByText('Terms of Service')).toBeInTheDocument());

    const exportBtn = screen.getByRole('button', { name: /export/i });
    await user.click(exportBtn);

    await waitFor(() => {
      expect(mockExportAcceptances).toHaveBeenCalledWith(1, undefined, undefined);
    });
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });

    vi.restoreAllMocks();
  });

  it('shows export error toast when export fails', async () => {
    mockGetComplianceStats.mockResolvedValue({
      success: true,
      data: makeStats({ documents: [makeDoc()] }),
    });
    mockExportAcceptances.mockResolvedValue({ success: false, error: 'Export failed' });

    const user = userEvent.setup();
    render(<LegalDocComplianceDashboard />);
    await waitFor(() => expect(screen.getByText('Terms of Service')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /export/i }));
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('clears date range fields when clear button is clicked', async () => {
    mockGetComplianceStats.mockResolvedValue({ success: true, data: makeStats() });
    const user = userEvent.setup();
    render(<LegalDocComplianceDashboard />);
    await waitFor(() => expect(screen.getByText('500')).toBeInTheDocument());

    // Find the date inputs (type="date")
    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBeGreaterThanOrEqual(1);
    const startInput = dateInputs[0] as HTMLInputElement;

    fireEvent.change(startInput, { target: { value: '2024-01-01' } });
    expect(startInput.value).toBe('2024-01-01');

    const clearBtn = screen.getByRole('button', { name: /clear/i });
    await user.click(clearBtn);
    expect(startInput.value).toBe('');
  });
});
