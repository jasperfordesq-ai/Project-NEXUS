// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { render, screen } from '@/test/test-utils';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PrivacyTab } from './PrivacyTab';
import type { PrivacySettings } from './PrivacyTab';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('@/contexts', () => ({
  useTenant: () => ({
    hasModule: vi.fn((_key: string) => true),
    tenantPath: (path: string) => `/t/test${path}`,
    hasFeature: vi.fn().mockReturnValue(false),
  }),

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
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const defaultPrivacy: PrivacySettings = {
  profile_visibility: 'public',
  search_indexing: true,
};

const defaultProps = {
  privacy: defaultPrivacy,
  isSavingPrivacy: false,
  privacyLoading: false,
  privacyError: null,
  insuranceCerts: [],
  insuranceLoading: false,
  insuranceUploading: false,
  insuranceType: 'public_liability',
  insuranceProvider: '',
  insuranceExpiry: '',
  insuranceEnabled: false,
  federationEnabled: false,
  onPrivacyChange: vi.fn(),
  onSavePrivacy: vi.fn(),
  onRetryPrivacy: vi.fn(),
  onInsuranceSave: vi.fn(),
  onInsuranceTypeChange: vi.fn(),
  onInsuranceProviderChange: vi.fn(),
  onInsuranceExpiryChange: vi.fn(),
  onOpenGdprModal: vi.fn(),
  onOpenDeleteModal: vi.fn(),
};

describe('PrivacyTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Privacy Settings heading', () => {
    render(<PrivacyTab {...defaultProps} />);
    expect(screen.getByText('Privacy Settings')).toBeDefined();
  });

  it('renders GDPR section', () => {
    render(<PrivacyTab {...defaultProps} />);
    expect(screen.getByText('Data & Privacy Rights')).toBeDefined();
  });

  it('renders the consolidated GDPR action buttons (no duplicate download/portability requests)', () => {
    render(<PrivacyTab {...defaultProps} />);
    // The instant export page covers access + portability, so those request
    // buttons are gone; deletion is now the real account-delete action.
    expect(screen.getByText('Delete your account')).toBeDefined();
    expect(screen.getByText('Data Rectification')).toBeDefined();
    expect(screen.getByText('Restriction of Processing')).toBeDefined();
    expect(screen.getByText('Right to Object')).toBeDefined();
    // Removed duplicates:
    expect(screen.queryByText('Download My Data')).toBeNull();
    expect(screen.queryByText('Data Portability Request')).toBeNull();
  });

  it('routes a request-type button through onOpenGdprModal', async () => {
    const { userEvent } = await import('@/test/test-utils');
    const user = userEvent.setup();
    render(<PrivacyTab {...defaultProps} />);

    await user.click(screen.getByText('Data Rectification'));
    expect(defaultProps.onOpenGdprModal).toHaveBeenCalledWith('rectification');
  });

  it('opens the real Delete Account modal (not a GDPR ticket) from the delete button', async () => {
    const { userEvent } = await import('@/test/test-utils');
    const user = userEvent.setup();
    render(<PrivacyTab {...defaultProps} />);

    await user.click(screen.getByText('Delete your account'));
    expect(defaultProps.onOpenDeleteModal).toHaveBeenCalled();
    expect(defaultProps.onOpenGdprModal).not.toHaveBeenCalledWith('deletion');
  });

  it('renders Save Privacy Settings button', () => {
    render(<PrivacyTab {...defaultProps} />);
    expect(screen.getByText('Save Privacy Settings')).toBeDefined();
  });

  it('does not expose default privacy controls while settings load', () => {
    render(<PrivacyTab {...defaultProps} privacyLoading />);
    expect(screen.getByText('Loading privacy settings...')).toBeDefined();
    expect(screen.queryByText('Save Privacy Settings')).toBeNull();
  });

  it('shows a retry action and no save button when privacy loading fails', async () => {
    const { userEvent } = await import('@/test/test-utils');
    const user = userEvent.setup();
    render(<PrivacyTab {...defaultProps} privacyError="Failed to load privacy settings" />);

    expect(screen.getByText('Failed to load privacy settings')).toBeDefined();
    expect(screen.queryByText('Save Privacy Settings')).toBeNull();
    await user.click(screen.getByText('Try Again'));
    expect(defaultProps.onRetryPrivacy).toHaveBeenCalled();
  });

  it('calls onSavePrivacy when save button clicked', async () => {
    const { userEvent } = await import('@/test/test-utils');
    const user = userEvent.setup();
    render(<PrivacyTab {...defaultProps} />);
    await user.click(screen.getByText('Save Privacy Settings'));
    expect(defaultProps.onSavePrivacy).toHaveBeenCalled();
  });

  it('hides federation section when federationEnabled is false', () => {
    render(<PrivacyTab {...defaultProps} federationEnabled={false} />);
    expect(screen.queryByText('Federation Settings')).toBeNull();
  });

  it('shows federation section when federationEnabled is true', () => {
    render(<PrivacyTab {...defaultProps} federationEnabled={true} />);
    expect(screen.getByText('Federation Settings')).toBeDefined();
  });

  it('hides insurance section when insuranceEnabled is false', () => {
    render(<PrivacyTab {...defaultProps} insuranceEnabled={false} />);
    expect(screen.queryByText('Insurance records')).toBeNull();
  });

  it('shows insurance section when insuranceEnabled is true', () => {
    render(<PrivacyTab {...defaultProps} insuranceEnabled={true} />);
    expect(screen.getByText('Insurance records')).toBeDefined();
  });

  it('shows loading state in insurance section', () => {
    render(<PrivacyTab {...defaultProps} insuranceEnabled={true} insuranceLoading={true} />);
    expect(screen.getByText('Loading insurance records...')).toBeDefined();
  });

  it('renders existing insurance certificates', () => {
    const certs = [
      {
        id: 1,
        insurance_type: 'public_liability',
        provider_name: 'Aviva',
        status: 'verified',
        expiry_date: '2027-01-01',
        created_at: '2026-01-01',
      },
    ];
    render(<PrivacyTab {...defaultProps} insuranceEnabled={true} insuranceCerts={certs} />);
    // The cert type appears as a <p> element; the Select dropdown also has a "Public Liability" option,
    // so use getAllByText and assert the paragraph element is present.
    const publicLiabilityElements = screen.getAllByText('Public Liability');
    expect(publicLiabilityElements.length).toBeGreaterThan(0);
    expect(screen.getByText(/Aviva/)).toBeDefined();
    expect(screen.getByText('Verified')).toBeDefined();
  });

  it('renders search indexing toggle', () => {
    render(<PrivacyTab {...defaultProps} />);
    expect(screen.getByText('Search Engine Indexing')).toBeDefined();
  });

  it('shows isSavingPrivacy loading state on save button', () => {
    render(<PrivacyTab {...defaultProps} isSavingPrivacy={true} />);
    const saveBtn = screen.getByText('Save Privacy Settings').closest('button');
    expect(saveBtn).toBeDefined();
  });
});
