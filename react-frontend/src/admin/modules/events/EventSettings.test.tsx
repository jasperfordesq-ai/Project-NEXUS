// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('../../api/adminApi', () => ({
  adminConfig: {
    getEventConfig: vi.fn().mockResolvedValue({
      success: true,
      data: {
        config: {
          creation_role: 'members', moderation_required: false, registration_enabled: true,
          default_capacity: 0, guest_registration_enabled: true, waitlist_enabled: true,
          timed_waitlist_offers_enabled: false, recurrence_enabled: true, reminders_enabled: true,
          organizer_broadcasts_enabled: true, offline_checkin_enabled: true,
          calendar_feeds_enabled: true, federation_sharing_enabled: true,
          safety_enforcement_mode: null, notification_delivery_mode: null,
        },
        defaults: {}, version: 0,
        capabilities: {
          recurrence_v2: false, rolling_recurrence: false,
          recurrence_definition_blueprints: false, timed_waitlist_offers: false,
          attendance_credits: false, optional_analytics_capture: false,
          registration_forms: true, invitation_campaigns: true, ticketing: true,
          agenda: true, offline_sync: true, broadcast_delivery: true,
          safety_evidence: true, federation_delivery: true, notification_consumer: true,
          notification_delivery: { resolved_mode: 'outbox_authoritative', source: 'global' },
          safety: { resolved_mode: 'off', source: 'global', configuration_valid: true },
        },
        impact: {
          active_registrations: 0, active_waitlist_entries: 0, pending_reminders: 0,
          active_calendar_tokens: 0, shared_events: 0, scheduled_broadcasts: 0,
        },
      },
    }),
    getEventConfigAuditLog: vi.fn().mockResolvedValue({ success: true, data: [] }),
    updateEventConfig: vi.fn(),
    restoreEventConfigDefaults: vi.fn(),
  },
}));

const mockToast = { success: vi.fn(), error: vi.fn() };
const { mockHasFeature, mockNavigate } = vi.hoisted(() => ({
  mockHasFeature: vi.fn((_key: string) => true),
  mockNavigate: vi.fn(),
}));
vi.mock('@/contexts', () => createMockContexts({
  useToast: () => mockToast,
  useTenant: () => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: mockHasFeature,
    hasModule: vi.fn((_key: string) => true),
  }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn() }));

import EventSettings from './EventSettings';
import { adminConfig } from '../../api/adminApi';

/** The shared fixture, with attendance credits ready at platform level. */
async function withPlatformAttendanceCredits() {
  const base = await adminConfig.getEventConfig();
  vi.mocked(adminConfig.getEventConfig).mockResolvedValueOnce({
    ...base,
    data: { ...base.data!, capabilities: { ...base.data!.capabilities, attendance_credits: true } },
  });
}

beforeEach(() => {
  mockHasFeature.mockImplementation(() => true);
  mockNavigate.mockReset();
});

describe('EventSettings', () => {
  it('renders the enterprise configuration surface without invalid compound components', async () => {
    render(<EventSettings />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Event settings' })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Platform readiness' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Current operational footprint' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Configuration history' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Event settings' })).toBeDisabled();
  });

  it('explains why Save is disabled instead of leaving a dead button', async () => {
    render(<EventSettings />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Event settings' })).toBeInTheDocument());

    // Nothing touched yet: Save is disabled because there is nothing to save,
    // and it says so. Previously it was simply inert, which read as a broken
    // page — the whole point of this fix.
    expect(screen.getByText('Nothing to save yet — change a setting first.')).toBeInTheDocument();
    expect(screen.queryByText(/Your changes are not live yet/)).not.toBeInTheDocument();

    // Flip a policy switch: now the blocker is the missing reason, and the page
    // says that at the top as well as beside the button.
    const registrationSwitch = screen.getByRole('switch', { name: 'Allow Event registration' });
    await userEvent.click(registrationSwitch);

    await waitFor(() => expect(screen.getByText(/Your changes are not live yet/)).toBeInTheDocument());
    expect(screen.getByText('Add a reason above to enable Save.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Event settings' })).toBeDisabled();

    // Give a reason and Save becomes usable, with the warning gone.
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Reason for change' }),
      'Turning registration off for the winter break.',
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Event settings' })).toBeEnabled());
    expect(screen.queryByText(/Your changes are not live yet/)).not.toBeInTheDocument();
  });

  it('says attendance rewards are off for THIS community when the platform has them ready', async () => {
    mockHasFeature.mockImplementation((key: string) => key !== 'event_attendance_credits');
    await withPlatformAttendanceCredits();
    render(<EventSettings />);

    await waitFor(() => expect(screen.getByText('Off for this community')).toBeInTheDocument());
    // Readiness no longer claims "Available" for attendance credits alone.
    expect(screen.getByText('Attendance rewards are switched off for this community')).toBeInTheDocument();
    expect(screen.queryByText(/also switched off at platform level/)).not.toBeInTheDocument();
    // The cap field stays hidden while the feature is off.
    expect(screen.queryByText('Monthly reward cap (credits)')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Open Module Configuration' }));
    expect(mockNavigate).toHaveBeenCalledWith('/test/admin/module-configuration');
  });

  it('adds the platform note when the platform switch is off as well', async () => {
    mockHasFeature.mockImplementation((key: string) => key !== 'event_attendance_credits');
    render(<EventSettings />);

    await waitFor(() => expect(screen.getByText('Attendance rewards are switched off for this community')).toBeInTheDocument());
    expect(screen.getByText(/also switched off at platform level/)).toBeInTheDocument();
    expect(screen.queryByText('Off for this community')).not.toBeInTheDocument();
  });

  it('shows the rewards settings and no feature-off notice when the community feature is on', async () => {
    await withPlatformAttendanceCredits();
    render(<EventSettings />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Attendance rewards' })).toBeInTheDocument());
    expect(screen.queryByText('Attendance rewards are switched off for this community')).not.toBeInTheDocument();
    expect(screen.queryByText('Off for this community')).not.toBeInTheDocument();
  });
});
