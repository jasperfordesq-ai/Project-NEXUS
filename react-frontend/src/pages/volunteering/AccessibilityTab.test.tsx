// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for AccessibilityTab
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { framerMotionMock } from '@/test/mocks';

vi.mock('@/lib/motion', () => framerMotionMock);

const translations: Record<string, string> = {
  'accessibility.heading': 'Accessibility & Accommodations',
  'accessibility.save': 'Save Changes',
  'accessibility.privacy_notice': 'This is a private note for you. Organisations and coordinators cannot see it.',
  'accessibility.duplicate_type': 'Each type of need can only be added once.',
  'accessibility.load_error': 'Unable to load accessibility needs.',
  'accessibility.try_again': 'Try Again',
  'accessibility.no_needs_title': 'No accessibility needs added',
  'accessibility.no_needs_desc_private': 'Keep a private note of your accessibility needs. It is not shared with organisations or coordinators.',
  'accessibility.add_first': 'Add Your First Need',
  'accessibility.add_need': 'Add Another Need',
  'accessibility.types.mobility': 'mobility',
  'accessibility.remove': 'Remove',
};
const stableT = (key: string, fallback?: string | object) =>
  translations[key] ?? (typeof fallback === 'string' ? fallback : key);
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
    put: vi.fn().mockResolvedValue({ success: true }),
    post: vi.fn().mockResolvedValue({ success: true }),
  },
}));

const toastSpies = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@/contexts/ToastContext', () => ({
  useToast: vi.fn(() => toastSpies),
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

import { AccessibilityTab } from './AccessibilityTab';
import { api } from '@/lib/api';

const mockNeed = {
  id: 1,
  need_type: 'mobility' as const,
  description: 'Wheelchair access required',
  accommodations_required: 'Ground floor venues only',
  emergency_contact_name: 'Jane Doe',
  emergency_contact_phone: '+1 555 123 4567',
};

describe('AccessibilityTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the heading and Save Changes button', () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<AccessibilityTab />);
    expect(screen.getByText('Accessibility & Accommodations')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save Changes/i })).toBeInTheDocument();
  });

  // F-227: no organisation or coordinator can read these needs, so the screen
  // must say they are private to the member — not that they help organisations.
  it('tells the member the needs are private and not seen by organisations or coordinators', () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<AccessibilityTab />);
    expect(screen.getByText(/Organisations and coordinators cannot see it/)).toBeInTheDocument();
    expect(screen.queryByText('accessibility.info_banner')).not.toBeInTheDocument();
  });

  it('describes the empty state as a private note, not as sharing with organisations', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<AccessibilityTab />);
    await waitFor(() => {
      expect(screen.getByText(/Keep a private note of your accessibility needs/)).toBeInTheDocument();
    });
    expect(screen.queryByText('accessibility.no_needs_desc')).not.toBeInTheDocument();
  });

  // F-227: two needs of the same type cannot be stored (one per type), and the
  // save used to report success anyway. Refuse before sending, keep the form.
  it('refuses to save two needs of the same type and keeps the form', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<AccessibilityTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Add Your First Need/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Add Another Need/i }));
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
    await waitFor(() => {
      expect(toastSpies.error).toHaveBeenCalledWith('Each type of need can only be added once.');
    });
    expect(api.put).not.toHaveBeenCalled();
    expect(toastSpies.success).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Add Another Need/i })).toBeInTheDocument();
  });

  it('reports an error, not success, when the server refuses the save', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [mockNeed] });
    vi.mocked(api.put).mockResolvedValue({ success: false, error: 'Invalid input' });
    render(<AccessibilityTab />);
    await waitFor(() => {
      expect(screen.getAllByText('mobility').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
    await waitFor(() => {
      expect(toastSpies.error).toHaveBeenCalled();
    });
    expect(toastSpies.success).not.toHaveBeenCalled();
  });

  it('shows empty state when no needs exist', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<AccessibilityTab />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.getByText('No accessibility needs added')).toBeInTheDocument();
    });
  });

  it('shows loading skeleton while data is being fetched', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<AccessibilityTab />);
    // The loading skeleton renders inside a role="status" container.
    const loadingContainers = screen.getAllByRole('status');
    expect(loadingContainers.length).toBeGreaterThan(0);
  });

  it('displays accessibility needs when data is loaded', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [mockNeed] });
    render(<AccessibilityTab />);
    await waitFor(() => {
      expect(screen.getAllByText('mobility').length).toBeGreaterThan(0);
    });
  });

  it('shows Add Your First Need button in empty state', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<AccessibilityTab />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Your First Need/i })).toBeInTheDocument();
    });
  });

  it('shows error state and Try Again button when API fails', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false, data: null });
    render(<AccessibilityTab />);
    await waitFor(() => {
      expect(screen.getByText('Unable to load accessibility needs.')).toBeInTheDocument();
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
      return Promise.resolve({ success: true, data: [] });
    });
    render(<AccessibilityTab />);
    await waitFor(() => {
      expect(screen.getByText('Unable to load accessibility needs.')).toBeInTheDocument();
    });
    const buttons = screen.getAllByRole('button');
    const tryAgainBtn = buttons.find((btn) => btn.textContent?.includes('Try Again'));
    fireEvent.click(tryAgainBtn!);
    await waitFor(() => {
      expect(callCount).toBe(2);
    });
  });

  it('calls api.put when Save Changes is clicked', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [mockNeed] });
    vi.mocked(api.put).mockResolvedValue({ success: true });
    render(<AccessibilityTab />);
    await waitFor(() => {
      expect(screen.getAllByText('mobility').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/v2/volunteering/accessibility-needs', {
        needs: [mockNeed],
      });
    });
  });

  it('shows Add Another Need button when needs exist', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [mockNeed] });
    render(<AccessibilityTab />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Another Need/i })).toBeInTheDocument();
    });
  });
});
