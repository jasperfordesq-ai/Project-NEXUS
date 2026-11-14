// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for GoalTemplatePickerModal
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
vi.mock('@/lib/motion', async () => {
  const { framerMotionMock } = await import('@/test/mocks');
  return framerMotionMock;
});

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [] }),
    post: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('@/contexts', () => ({
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  })),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null }),
  useTenant: () => ({ tenant: { id: 2, name: 'Test', slug: 'test', tagline: null }, branding: { name: 'Test', logo_url: null }, tenantSlug: 'test', tenantPath: (p) => '/test' + p, isLoading: false, hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true) }),
}));

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

import { GoalTemplatePickerModal } from '../GoalTemplatePickerModal';
import { api } from '@/lib/api';

const mockTemplate = {
  id: 1,
  title: 'Run 5K',
  description: 'Train to run a 5K in 3 months',
  target_value: 5,
  category: 'fitness',
  is_public: true,
  duration_days: 90,
};

const mockTemplate2 = {
  id: 2,
  title: 'Read 12 Books',
  description: 'Read one book per month for a year',
  target_value: 12,
  category: 'learning',
  is_public: true,
  duration_days: 365,
};

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  onTemplateSelected: vi.fn(),
};

describe('GoalTemplatePickerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the modal heading when open', () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<GoalTemplatePickerModal {...defaultProps} />);
    expect(screen.getByText('Start from Template')).toBeInTheDocument();
  });

  it('shows empty state when no templates are available', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<GoalTemplatePickerModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('No templates available yet.')).toBeInTheDocument();
    });
  });

  it('shows error state with Try Again button when API fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));
    render(<GoalTemplatePickerModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("That didn't load. Try again in a moment.")).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument();
  });

  it('renders template cards when templates are available', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: [mockTemplate, mockTemplate2] })
      .mockResolvedValueOnce({ success: true, data: ['fitness', 'learning'] });
    render(<GoalTemplatePickerModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Run 5K')).toBeInTheDocument();
    });
    expect(screen.getByText('Read 12 Books')).toBeInTheDocument();
    expect(screen.getByText('Train to run a 5K in 3 months')).toBeInTheDocument();
  });

  it('renders category filter buttons when categories are returned', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: [mockTemplate, mockTemplate2] })
      .mockResolvedValueOnce({ success: true, data: ['fitness', 'learning'] });
    render(<GoalTemplatePickerModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /fitness/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /learning/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^All$/i })).toBeInTheDocument();
    });
  });

  it('filters templates when a category button is clicked', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: [mockTemplate, mockTemplate2] })
      .mockResolvedValueOnce({ success: true, data: ['fitness', 'learning'] });
    render(<GoalTemplatePickerModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Run 5K')).toBeInTheDocument();
      expect(screen.getByText('Read 12 Books')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /fitness/i }));
    await waitFor(() => {
      expect(screen.getByText('Run 5K')).toBeInTheDocument();
      expect(screen.queryByText('Read 12 Books')).not.toBeInTheDocument();
    });
  });

  it('calls POST with correct templateId when Use Template button is clicked', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: [mockTemplate] })
      .mockResolvedValueOnce({ success: true, data: ['fitness'] });
    vi.mocked(api.post).mockResolvedValue({ success: true });
    render(<GoalTemplatePickerModal {...defaultProps} />);
    await waitFor(() => screen.getByLabelText(/Use template: Run 5K/i));
    fireEvent.click(screen.getByLabelText(/Use template: Run 5K/i));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v2/goals/from-template/1', {});
    });
  });

  it('calls onTemplateSelected and onClose after successful template use', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: [mockTemplate] })
      .mockResolvedValueOnce({ success: true, data: ['fitness'] });
    vi.mocked(api.post).mockResolvedValue({ success: true });
    const onTemplateSelected = vi.fn();
    const onClose = vi.fn();
    render(<GoalTemplatePickerModal isOpen={true} onClose={onClose} onTemplateSelected={onTemplateSelected} />);
    await waitFor(() => screen.getByLabelText(/Use template: Run 5K/i));
    fireEvent.click(screen.getByLabelText(/Use template: Run 5K/i));
    await waitFor(() => {
      expect(onTemplateSelected).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('renders Cancel button', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<GoalTemplatePickerModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
    });
  });

  it('does not render when isOpen is false', () => {
    render(<GoalTemplatePickerModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('Start from Template')).not.toBeInTheDocument();
  });
});
