// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for SafeguardingTab
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { framerMotionMock } from '@/test/mocks';

vi.mock('@/lib/motion', () => framerMotionMock);

const safeguardingTranslations: Record<string, string> = {
  'safeguarding.add_training': 'Add Training',
  'safeguarding.heading': 'Safeguarding',
  'safeguarding.incident_reports': 'Incident Reports',
  'safeguarding.load_error': 'Unable to load safeguarding data.',
  'safeguarding.no_incidents_title': 'No incidents reported',
  'safeguarding.no_training_title': 'No training records',
  'safeguarding.report_incident': 'Report Incident',
  'safeguarding.training_records': 'Training Records',
  'safeguarding.try_again': 'Try Again',
};

const stableT = (key: string, fallbackOrOptions?: string | Record<string, unknown>, _opts?: object) => {
  if (typeof fallbackOrOptions === 'string') return fallbackOrOptions;
  return safeguardingTranslations[key] ?? key;
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: stableT,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
  Trans: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [] }),
    post: vi.fn().mockResolvedValue({ success: true }),
  },
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
  EmptyState: ({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
      {action}
    </div>
  ),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

// The report form has its own tests (ReportIncidentModal.test.tsx).
vi.mock('./ReportIncidentModal', () => ({
  ReportIncidentModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="report-incident-modal" /> : null),
}));

import { SafeguardingTab } from './SafeguardingTab';
import { api } from '@/lib/api';

const mockTraining = {
  id: 1,
  training_type: 'children_first' as const,
  training_name: 'Children First Training',
  provider: 'HSE',
  completed_at: '2026-01-15',
  expires_at: '2027-01-15',
  status: 'verified' as const,
  created_at: '2026-01-15T10:00:00Z',
};

const mockIncident = {
  id: 1,
  title: 'Near miss at community garden',
  description: 'A volunteer tripped on uneven ground near the main entrance.',
  severity: 'medium' as const,
  category: 'Health & Safety',
  status: 'open' as const,
  created_at: '2026-03-10T10:00:00Z',
};

describe('SafeguardingTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the heading and sub-view toggle buttons', () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<SafeguardingTab />);
    expect(screen.getByText('Safeguarding')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Training Records/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Incident Reports/i })).toBeInTheDocument();
  });

  it('shows Add Training button in training sub-view', () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<SafeguardingTab />);
    expect(screen.getByRole('button', { name: /Add Training/i })).toBeInTheDocument();
  });

  it('shows empty state for training records when none exist', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<SafeguardingTab />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.getByText('No training records')).toBeInTheDocument();
    });
  });

  it('shows loading skeleton while data is being fetched', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<SafeguardingTab />);
    // The loading skeleton renders inside a role="status" container.
    const loadingContainers = screen.getAllByRole('status');
    expect(loadingContainers.length).toBeGreaterThan(0);
  });

  it('displays training records when data is loaded', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: [mockTraining] })
      .mockResolvedValueOnce({ success: true, data: [] });
    render(<SafeguardingTab />);
    await waitFor(() => {
      expect(screen.getByText('Children First Training')).toBeInTheDocument();
    });
  });

  it('switches to incidents sub-view and shows empty state', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<SafeguardingTab />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Incident Reports/i }));
    await waitFor(() => {
      expect(screen.getByText('No incidents reported')).toBeInTheDocument();
    });
  });

  it('shows Report Incident button when in incidents sub-view', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<SafeguardingTab />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Incident Reports/i }));
    expect(screen.getByRole('button', { name: /Report Incident/i })).toBeInTheDocument();
  });

  it('displays incidents when data is loaded and incident sub-view is active', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockResolvedValueOnce({ success: true, data: [mockIncident] });
    render(<SafeguardingTab />);
    await waitFor(() => {
      expect(screen.queryByText('Safeguarding')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Incident Reports/i }));
    await waitFor(() => {
      expect(screen.getByText('Near miss at community garden')).toBeInTheDocument();
    });
    expect(screen.getByText('Health & Safety')).toBeInTheDocument();
  });

  it('shows error state and Try Again button when API fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));
    render(<SafeguardingTab />);
    await waitFor(() => {
      expect(screen.getByText('Unable to load safeguarding data.')).toBeInTheDocument();
    });
    const buttons = screen.getAllByRole('button');
    const tryAgainBtn = buttons.find((btn) => btn.textContent?.includes('Try Again'));
    expect(tryAgainBtn).toBeTruthy();
  });

  it('retries loading when Try Again is clicked', async () => {
    let callCount = 0;
    vi.mocked(api.get).mockImplementation(() => {
      callCount++;
      if (callCount <= 2) return Promise.reject(new Error('fail'));
      return Promise.resolve({ success: true, data: [] });
    });
    render(<SafeguardingTab />);
    await waitFor(() => {
      expect(screen.getByText('Unable to load safeguarding data.')).toBeInTheDocument();
    });
    const buttons = screen.getAllByRole('button');
    const tryAgainBtn = buttons.find((btn) => btn.textContent?.includes('Try Again'));
    fireEvent.click(tryAgainBtn!);
    await waitFor(() => {
      expect(callCount).toBeGreaterThanOrEqual(3);
    });
  });
});
