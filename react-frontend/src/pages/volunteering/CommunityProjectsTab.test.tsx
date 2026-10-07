// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for CommunityProjectsTab
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { framerMotionMock } from '@/test/mocks';

vi.mock('@/lib/motion', () => framerMotionMock);

const communityProjectTranslations: Record<string, string> = {
  'community_projects.heading': 'Community Projects',
  'community_projects.propose': 'Propose a Project',
  'community_projects.empty_title': 'No community projects yet',
  'community_projects.empty_description': 'Propose a project to mobilize your community.',
  'community_projects.load_error': 'Unable to load community projects.',
  'community_projects.try_again': 'Try Again',
  'community_projects.status.proposed': 'Proposed',
};

const stableT = (key: string, opts?: { count?: number }) => {
  if (key === 'community_projects.volunteers_needed') {
    return `${opts?.count ?? 0} volunteers needed`;
  }
  return communityProjectTranslations[key] ?? key;
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
    get: vi.fn().mockResolvedValue({ success: true, data: { items: [], has_more: false } }),
    post: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
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

import { CommunityProjectsTab } from './CommunityProjectsTab';
import { api } from '@/lib/api';

const mockProject = {
  id: 1,
  title: 'Community Garden',
  description: 'A shared garden for growing vegetables.',
  category: 'Environment',
  location: 'Central Park',
  target_volunteers: 10,
  proposed_date: '2026-06-01',
  status: 'proposed' as const,
  supporter_count: 5,
  has_supported: false,
  proposer_name: 'Alice Smith',
  created_at: '2026-03-01T10:00:00Z',
};

describe('CommunityProjectsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the heading and Propose a Project button', () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { items: [], has_more: false } });
    render(<CommunityProjectsTab />);
    expect(screen.getByText('Community Projects')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Propose a Project/i })).toBeInTheDocument();
  });

  it('shows empty state when no projects exist', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { items: [], has_more: false } });
    render(<CommunityProjectsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.getByText('No community projects yet')).toBeInTheDocument();
    });
  });

  // Gap C6: "Be the first to propose…" — the button is now in the empty state.
  it('offers to propose a project from the empty state', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { items: [], has_more: false } });
    render(<CommunityProjectsTab />);
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
    const inEmptyState = screen.getByTestId('empty-state').querySelector('button');
    expect(inEmptyState).toHaveTextContent('Propose a Project');
    fireEvent.click(inEmptyState!);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('shows loading skeleton while data is being fetched', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<CommunityProjectsTab />);
    // The loading skeleton renders inside a role="status" container.
    const loadingContainers = screen.getAllByRole('status');
    expect(loadingContainers.length).toBeGreaterThan(0);
  });

  it('displays project cards when data is loaded', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { items: [mockProject], has_more: false },
    });
    render(<CommunityProjectsTab />);
    await waitFor(() => {
      expect(screen.getByText('Community Garden')).toBeInTheDocument();
    });
    expect(screen.getByText('A shared garden for growing vegetables.')).toBeInTheDocument();
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Environment')).toBeInTheDocument();
    expect(screen.getByText('Central Park')).toBeInTheDocument();
  });

  it('shows error state and Try Again button when API fails', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false, data: null });
    render(<CommunityProjectsTab />);
    await waitFor(() => {
      expect(screen.getByText('Unable to load community projects.')).toBeInTheDocument();
    });
    const buttons = screen.getAllByRole('button');
    const tryAgainBtn = buttons.find((btn) => btn.textContent?.includes('Try Again'));
    expect(tryAgainBtn).toBeTruthy();
  });

  it('retries loading when Try Again is clicked', async () => {
    let callCount = 0;
    vi.mocked(api.get).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ success: false, data: null });
      return Promise.resolve({ success: true, data: { items: [], has_more: false } });
    });
    render(<CommunityProjectsTab />);
    await waitFor(() => {
      expect(screen.getByText('Unable to load community projects.')).toBeInTheDocument();
    });
    const buttons = screen.getAllByRole('button');
    const tryAgainBtn = buttons.find((btn) => btn.textContent?.includes('Try Again'));
    fireEvent.click(tryAgainBtn!);
    await waitFor(() => {
      expect(callCount).toBe(2);
    });
  });

  it('shows project status chip', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { items: [mockProject], has_more: false },
    });
    render(<CommunityProjectsTab />);
    await waitFor(() => {
      expect(screen.getByText('Proposed')).toBeInTheDocument();
    });
  });

  it('shows supporter count on the support button', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { items: [mockProject], has_more: false },
    });
    render(<CommunityProjectsTab />);
    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument();
    });
  });
});
