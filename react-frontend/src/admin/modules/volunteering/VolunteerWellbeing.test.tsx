// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * VolunteerWellbeing — the admin Wellbeing page: the alert list, the alert
 * drawer (opened from a bell or email link with ?alert=), and, for community
 * administrators only, the wellbeing settings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import type { User } from '@/types/api';

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
const authState = vi.hoisted(() => ({ user: { id: 1, role: 'admin', is_admin: true } as Record<string, unknown> }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({
      user: authState.user as unknown as User,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
  }),
);

const mockApi = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi, API_BASE: 'http://localhost/api' }));

const mockAdminApi = vi.hoisted(() => ({
  getWellbeingAlert: vi.fn(),
  addWellbeingAlertNote: vi.fn(),
  updateWellbeingAlert: vi.fn(),
  getWellbeingSettings: vi.fn(),
  updateWellbeingSettings: vi.fn(),
}));
vi.mock('../../api/adminApi', () => ({ adminVolunteering: mockAdminApi }));

import { VolunteerWellbeing } from './VolunteerWellbeing';

const ALERT = {
  id: 71,
  user_id: 12,
  user_name: 'Pat Murphy',
  risk_level: 'high',
  status: 'active',
  reason: 'low_mood',
  latest_checkin: { mood: 1, note: null, created_at: '2026-10-20T12:05:22Z' },
  told_count: 2,
  last_told_at: '2026-10-20T12:05:22Z',
  created_at: '2026-10-20T12:05:22Z',
};

const DETAIL = {
  alert: { ...ALERT, avatar_url: null, risk_score: 65, coordinator_notified: true, legacy_notes: null, resolved_at: null, updated_at: '2026-10-20T12:05:22Z' },
  indicators: {},
  checkins: [],
  notifications: [],
  notes: [],
};

describe('VolunteerWellbeing page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { id: 1, role: 'admin', is_admin: true };
    window.history.pushState({}, '', '/test/admin/volunteering/wellbeing');
    mockApi.get.mockImplementation((url: string) => Promise.resolve(
      url.startsWith('/v2/admin/volunteering/wellbeing/alerts')
        ? { success: true, data: [ALERT] }
        : { success: true, data: {} },
    ));
    mockAdminApi.getWellbeingAlert.mockResolvedValue({ success: true, data: DETAIL });
    mockAdminApi.getWellbeingSettings.mockResolvedValue({
      success: true,
      data: { contact_user_ids: [], contacts: [], contact_email: null, support_text: '', support_links: [], defaults: { support_text: 'Contact your team.', support_links: [] } },
    });
  });

  it('lists the alerts with how many people were told, and shows the settings to an administrator', async () => {
    render(<VolunteerWellbeing />);

    expect(await screen.findByText('Pat Murphy')).toBeInTheDocument();
    expect(screen.getByText(/told 2 people/i)).toBeInTheDocument();
    expect(await screen.findByText(/who is told first/i)).toBeInTheDocument();
  });

  it('hides the settings from a broker', async () => {
    authState.user = { id: 2, role: 'broker' };
    render(<VolunteerWellbeing />);

    expect(await screen.findByText('Pat Murphy')).toBeInTheDocument();
    expect(screen.queryByText(/who is told first/i)).not.toBeInTheDocument();
    expect(mockAdminApi.getWellbeingSettings).not.toHaveBeenCalled();
  });

  it('opens the alert named in the address, as a bell or email link does', async () => {
    window.history.pushState({}, '', '/test/admin/volunteering/wellbeing?alert=71');
    render(<VolunteerWellbeing />);

    await waitFor(() => expect(mockAdminApi.getWellbeingAlert).toHaveBeenCalledWith(71));
  });
});
