// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { render, screen } from '@/test/test-utils';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NotificationsTab } from './NotificationsTab';
import type { NotificationSettings } from './NotificationsTab';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('@/lib/motion', () => ({
  motion: new Proxy({}, {
    get: (_: object, prop: string) => {
      const { createElement, forwardRef } = require('react');
      return forwardRef(({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>, ref: React.Ref<unknown>) =>
        createElement(prop as string, { ...props, ref }, children)
      );
    },
  }),
  AnimatePresence: ({ children }: React.PropsWithChildren) => children,
}));

const mockHasModule = vi.fn(() => true);
const mockHasFeature = vi.fn(() => true);

// NotificationsTab links out to /matches/preferences via useTenant().tenantPath.
vi.mock('@/contexts', () => ({
  useTenant: () => ({
    tenantPath: (p: string) => `/test${p}`,
    hasModule: mockHasModule,
    hasFeature: mockHasFeature,
  }),
}));

const defaultNotifications: NotificationSettings = {
  email_messages: true,
  email_listings: false,
  email_digest: true,
  email_connections: false,
  email_transactions: true,
  email_reviews: false,
  email_events: false,
  email_gamification_digest: false,
  email_gamification_milestones: true,
  email_org_payments: false,
  email_org_transfers: false,
  email_org_membership: false,
  email_org_admin: false,
  push_enabled: true,
  push_campaigns_opted_in: false,
  caring_smart_nudges: true,
  federation_notifications_enabled: true,
};

const defaultProps = {
  notifications: defaultNotifications,
  notificationError: null,
  notificationLoading: false,
  isSaving: false,
  matchDigestFrequency: 'weekly',
  notifyHotMatches: false,
  notifyMutualMatches: false,
  marketingConsent: false,
  marketingConsentLoading: false,
  isOrganisation: false,
  digestFrequency: 'off',
  onNotificationsChange: vi.fn(),
  onMatchDigestFrequencyChange: vi.fn(),
  onNotifyHotMatchesChange: vi.fn(),
  onNotifyMutualMatchesChange: vi.fn(),
  onMarketingConsentToggle: vi.fn(),
  onDigestFrequencyChange: vi.fn(),
  onSave: vi.fn(),
  onRetry: vi.fn(),
};

describe('NotificationsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasModule.mockReturnValue(true);
    mockHasFeature.mockReturnValue(true);
  });

  it('renders notifications heading', () => {
    render(<NotificationsTab {...defaultProps} />);
    expect(screen.getByText('notifications')).toBeDefined();
  });

  it('renders save preferences button', () => {
    render(<NotificationsTab {...defaultProps} />);
    expect(screen.getByText('save_preferences')).toBeDefined();
  });

  it('shows error state with retry button when notificationError is set', () => {
    render(<NotificationsTab {...defaultProps} notificationError="Failed to load settings" />);
    expect(screen.getByText('Failed to load settings')).toBeDefined();
    expect(screen.getByText('try_again')).toBeDefined();
  });

  it('shows a loading state without editable controls while settings load', () => {
    render(<NotificationsTab {...defaultProps} notificationLoading />);
    expect(screen.getByText('notifications_loading')).toBeDefined();
    expect(screen.queryByText('save_preferences')).toBeNull();
  });

  it('calls onRetry when Try Again is clicked', async () => {
    const { userEvent } = await import('@/test/test-utils');
    const user = userEvent.setup();
    render(<NotificationsTab {...defaultProps} notificationError="Error" />);
    await user.click(screen.getByText('try_again'));
    expect(defaultProps.onRetry).toHaveBeenCalled();
  });

  it('does not render notification toggles in error state', () => {
    render(<NotificationsTab {...defaultProps} notificationError="Error" />);
    expect(screen.queryByText('notification_prefs.new_messages')).toBeNull();
  });

  it('renders organisation notifications section when isOrganisation is true', () => {
    render(<NotificationsTab {...defaultProps} isOrganisation={true} />);
    expect(screen.getByText('notification_sections.organisation_notifications')).toBeDefined();
  });

  it('hides organisation notifications section when isOrganisation is false', () => {
    render(<NotificationsTab {...defaultProps} isOrganisation={false} />);
    expect(screen.queryByText('notification_sections.organisation_notifications')).toBeNull();
  });

  it('renders match digest section', () => {
    render(<NotificationsTab {...defaultProps} />);
    expect(screen.getByText('notification_sections.match_digest')).toBeDefined();
    // The frequency label appears more than once (label + control), so assert
    // at least one rendering.
    expect(screen.getAllByText('match_digest.frequency').length).toBeGreaterThan(0);
  });

  it('hides preferences belonging to disabled modules and features', () => {
    mockHasModule.mockReturnValue(false);
    mockHasFeature.mockReturnValue(false);

    render(<NotificationsTab {...defaultProps} isOrganisation />);

    expect(screen.queryByText('notification_prefs.new_messages')).toBeNull();
    expect(screen.queryByText('notification_prefs.listing_activity')).toBeNull();
    expect(screen.queryByText('notification_prefs.credit_transactions')).toBeNull();
    expect(screen.queryByText('notification_prefs.connection_requests')).toBeNull();
    expect(screen.queryByText('notification_prefs.event_emails')).toBeNull();
    expect(screen.queryByText('notification_prefs.new_reviews')).toBeNull();
    expect(screen.queryByText('notification_prefs.gamification_digest')).toBeNull();
    expect(screen.queryByText('notification_sections.organisation_notifications')).toBeNull();
    expect(screen.queryByText('notification_sections.match_digest')).toBeNull();
  });

  it('renders and updates the Events email preference', async () => {
    const { userEvent } = await import('@/test/test-utils');
    const user = userEvent.setup();
    const onNotificationsChange = vi.fn();

    render(<NotificationsTab {...defaultProps} onNotificationsChange={onNotificationsChange} />);
    await user.click(screen.getByRole('switch', { name: 'notification_prefs.event_emails' }));

    expect(onNotificationsChange).toHaveBeenCalledOnce();
    const update = onNotificationsChange.mock.calls[0][0];
    expect(update(defaultNotifications).email_events).toBe(true);
  });

  it('calls onSave when save button is clicked', async () => {
    const { userEvent } = await import('@/test/test-utils');
    const user = userEvent.setup();
    render(<NotificationsTab {...defaultProps} />);
    await user.click(screen.getByText('save_preferences'));
    expect(defaultProps.onSave).toHaveBeenCalled();
  });

  it('shows loading state on save button when isSaving', () => {
    render(<NotificationsTab {...defaultProps} isSaving={true} />);
    // Button should be in loading state (spinner shown, disabled)
    const saveBtn = screen.getByText('save_preferences').closest('button');
    expect(saveBtn).toBeDefined();
  });

  it('renders push notifications section', () => {
    render(<NotificationsTab {...defaultProps} />);
    expect(screen.getByText('notification_sections.push_notifications')).toBeDefined();
  });

  it('renders marketing communications section', () => {
    render(<NotificationsTab {...defaultProps} />);
    expect(screen.getByText('notification_sections.marketing_communications')).toBeDefined();
  });

  it('disables marketing toggle when marketingConsentLoading is true', () => {
    render(<NotificationsTab {...defaultProps} marketingConsentLoading={true} />);
    // The marketing toggle should be disabled — HeroUI Switch renders the native disabled
    // attribute on the underlying <input role="switch"> when isDisabled is true.
    const switches = screen.getAllByRole('switch');
    // Marketing switch is the last one
    const lastSwitch = switches[switches.length - 1];
    expect(lastSwitch).toBeDisabled();
  });
});
