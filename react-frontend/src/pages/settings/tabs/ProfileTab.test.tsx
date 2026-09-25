// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { render, screen } from '@/test/test-utils';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ProfileTab } from './ProfileTab';
import type { ProfileFormData } from './ProfileTab';
import { AVATAR_UPLOAD_ACCEPT } from '@/lib/avatarUpload';
import { latestAdultDateOfBirth } from '@/lib/minimum-age';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('@/contexts', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),

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
  useTenant: () => ({ tenant: { id: 2, name: 'Test', slug: 'test', tagline: null }, branding: { name: 'Test', logo_url: null }, tenantSlug: 'test', tenantPath: (p) => '/test' + p, isLoading: false, hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true) }),
}));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (url: string | null) => url ?? '',
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('@/components/location', () => ({
  PlaceAutocompleteInput: ({ label }: { label: string }) => (
    <div data-testid="place-autocomplete">{label}</div>
  ),
}));

vi.mock('@/components/location/PlaceAutocompleteInput', () => ({
  PlaceAutocompleteInput: ({ label }: { label: string }) => (
    <div data-testid="place-autocomplete">{label}</div>
  ),
}));

vi.mock('@/components/LanguageSwitcher', () => ({
  LanguageSwitcher: () => <div data-testid="language-switcher" />,
}));

const defaultProfileData: ProfileFormData = {
  first_name: 'Alice',
  last_name: 'Smith',
  name: 'Alice Smith',
  phone: '+1 555 123 4567',
  tagline: 'Community helper',
  bio: 'I love timebanking',
  location: 'Dublin',
  latitude: 53.3,
  longitude: -6.26,
  avatar: null,
  profile_type: 'individual',
  organization_name: '',
};

const defaultProps = {
  profileData: defaultProfileData,
  isSaving: false,
  isUploading: false,
  isDirty: true,
  onProfileDataChange: vi.fn(),
  onSave: vi.fn(),
  onAvatarUpload: vi.fn(),
};

describe('ProfileTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Adults-only decision 2026-09-25: the picker cannot offer a date of birth
  // that would make the member under 18, and a refusal from the server is shown
  // against the field itself.
  it('limits the date of birth to adults', () => {
    render(<ProfileTab {...defaultProps} />);
    const dob = screen.getByLabelText('profile.date_of_birth') as HTMLInputElement;
    expect(dob.max).toBe(latestAdultDateOfBirth());
  });

  it('shows a date-of-birth refusal against the field', () => {
    render(<ProfileTab {...defaultProps} dobError="Server: must be 18." />);
    const dob = screen.getByLabelText('profile.date_of_birth');
    expect(dob).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Server: must be 18.')).toBeInTheDocument();
  });

  it('renders profile section title', () => {
    render(<ProfileTab {...defaultProps} />);
    expect(screen.getByText('profile.section_title')).toBeDefined();
  });

  it('renders first name and last name fields', () => {
    render(<ProfileTab {...defaultProps} />);
    expect(screen.getByDisplayValue('Alice')).toBeDefined();
    expect(screen.getByDisplayValue('Smith')).toBeDefined();
  });

  it('renders phone field with value', () => {
    render(<ProfileTab {...defaultProps} />);
    expect(screen.getByDisplayValue('+1 555 123 4567')).toBeDefined();
  });

  it('renders tagline field', () => {
    render(<ProfileTab {...defaultProps} />);
    expect(screen.getByDisplayValue('Community helper')).toBeDefined();
  });

  it('renders bio textarea', () => {
    render(<ProfileTab {...defaultProps} />);
    expect(screen.getByDisplayValue('I love timebanking')).toBeDefined();
  });

  it('renders Save Changes button', () => {
    render(<ProfileTab {...defaultProps} />);
    expect(screen.getByText('save_changes')).toBeDefined();
  });

  it('calls onSave when Save Changes is clicked', async () => {
    const { userEvent } = await import('@/test/test-utils');
    const user = userEvent.setup();
    render(<ProfileTab {...defaultProps} />);
    await user.click(screen.getByText('save_changes'));
    expect(defaultProps.onSave).toHaveBeenCalled();
  });

  it('does not show organisation name field for individual profile', () => {
    render(<ProfileTab {...defaultProps} />);
    expect(screen.queryByLabelText(/profile.org_name/i)).toBeNull();
  });

  it('shows organisation name field when profile_type is organisation', () => {
    render(<ProfileTab {...defaultProps} profileData={{ ...defaultProfileData, profile_type: 'organisation' }} />);
    // org_name label key should be rendered as part of an input
    expect(screen.getByText('profile.org_name')).toBeDefined();
  });

  it('renders language and appearance section', () => {
    render(<ProfileTab {...defaultProps} />);
    // The heading renders "{t('language')} & {t('appearance')}" in an <h2>.
    // Use a heading role query to avoid ambiguity with other elements that contain "language".
    expect(screen.getByRole('heading', { name: /language/ })).toBeDefined();
  });

  it('renders theme mode buttons', () => {
    render(<ProfileTab {...defaultProps} />);
    expect(screen.getByText('theme.light')).toBeDefined();
    expect(screen.getByText('theme.dark')).toBeDefined();
    expect(screen.getByText('theme.system')).toBeDefined();
  });

  it('renders LanguageSwitcher', () => {
    render(<ProfileTab {...defaultProps} />);
    expect(screen.getByTestId('language-switcher')).toBeDefined();
  });

  it('renders change photo button', () => {
    render(<ProfileTab {...defaultProps} />);
    expect(screen.getByLabelText('profile.change_photo_aria')).toBeDefined();
  });

  it('limits the avatar picker to supported image formats', () => {
    render(<ProfileTab {...defaultProps} />);
    expect(screen.getByLabelText('profile.upload_photo_aria')).toHaveAttribute('accept', AVATAR_UPLOAD_ACCEPT);
  });

  it('shows loading state on save button when isSaving', () => {
    render(<ProfileTab {...defaultProps} isSaving={true} />);
    const saveBtn = screen.getByText('save_changes').closest('button');
    expect(saveBtn).toBeDefined();
  });

  it('shows uploading state on camera button when isUploading', () => {
    render(<ProfileTab {...defaultProps} isUploading={true} />);
    const cameraBtn = screen.getByLabelText('profile.change_photo_aria');
    // HeroUI Button renders isDisabled as data-disabled, not aria-disabled
    expect(cameraBtn).toHaveAttribute('data-disabled', 'true');
  });
});
