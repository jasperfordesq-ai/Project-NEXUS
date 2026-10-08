// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), patch: jest.fn(), upload: jest.fn() },
  ApiResponseError: class ApiResponseError extends Error {
    status!: number;
    constructor(status: number, message: string) { super(message); this.status = status; this.name = 'ApiResponseError'; }
  },
  registerUnauthorizedCallback: jest.fn(),
}));
jest.mock('@/lib/constants', () => ({
  API_V2: '/api/v2',
  API_BASE_URL: 'https://test.api',
  STORAGE_KEYS: { AUTH_TOKEN: 'auth_token', REFRESH_TOKEN: 'refresh_token', TENANT_SLUG: 'tenant_slug', USER_DATA: 'user_data' },
  TIMEOUTS: { API_REQUEST: 15_000 },
  DEFAULT_TENANT: 'test-tenant',
}));

import { api } from '@/lib/api/client';
import {
  addGroupReservationMember,
  cancelGroupReservation,
  claimWaitlistPlace,
  createQualification,
  emergencyAlertItems,
  getEmergencyAlerts,
  getGroupReservations,
  getIncidentReportOptions,
  getMyGroupsForReservation,
  getMyIncidents,
  getMyWaitlists,
  getQualifications,
  getShiftCheckIn,
  getWellbeing,
  joinWaitlist,
  leadableGroups,
  leaveWaitlist,
  myIncidentItems,
  removeGroupReservationMember,
  reportIncident,
  reserveGroupPlaces,
  respondToEmergencyAlert,
  submitVolunteerExpenseWithReceipt,
  submitWellbeingCheckin,
  updateAccessibilityNeeds,
  updateQualification,
  volunteerSwitchOn,
  withdrawQualification,
} from './volunteeringVolunteer';

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(api.get).mockResolvedValue({ data: [] });
  jest.mocked(api.post).mockResolvedValue({ data: {} });
  jest.mocked(api.put).mockResolvedValue({ data: {} });
  jest.mocked(api.delete).mockResolvedValue(undefined);
  jest.mocked(api.upload).mockResolvedValue({ data: {} });
});

describe('community switches', () => {
  it('reads the prefixed bootstrap keys and treats an absent switch as on', () => {
    expect(volunteerSwitchOn({ 'volunteering.tab_wellbeing': false }, 'tab_wellbeing')).toBe(false);
    expect(volunteerSwitchOn({ 'volunteering.tab_wellbeing': true }, 'tab_wellbeing')).toBe(true);
    expect(volunteerSwitchOn({}, 'tab_wellbeing')).toBe(true);
    expect(volunteerSwitchOn(undefined, 'enable_qr_checkin')).toBe(true);
  });

  it('🔴 keeps group sign-ups OFF unless the community opted in', () => {
    expect(volunteerSwitchOn({}, 'tab_group_signups')).toBe(false);
    expect(volunteerSwitchOn(undefined, 'tab_group_signups')).toBe(false);
    expect(volunteerSwitchOn({ 'volunteering.tab_group_signups': false }, 'tab_group_signups')).toBe(false);
    expect(volunteerSwitchOn({ 'volunteering.tab_group_signups': true }, 'tab_group_signups')).toBe(true);
  });
});

describe('waiting lists', () => {
  it('joins, leaves and claims against the SHIFT id with the website\'s empty body', async () => {
    await getMyWaitlists();
    expect(api.get).toHaveBeenLastCalledWith('/api/v2/volunteering/my-waitlists');
    await joinWaitlist(44);
    expect(api.post).toHaveBeenLastCalledWith('/api/v2/volunteering/shifts/44/waitlist', {});
    await leaveWaitlist(44);
    expect(api.delete).toHaveBeenLastCalledWith('/api/v2/volunteering/shifts/44/waitlist');
    await claimWaitlistPlace(44);
    expect(api.post).toHaveBeenLastCalledWith('/api/v2/volunteering/shifts/44/waitlist/promote', {});
  });
});

describe('own check-in code', () => {
  it('asks for the member\'s own token on a shift', async () => {
    await getShiftCheckIn(9);
    expect(api.get).toHaveBeenLastCalledWith('/api/v2/volunteering/shifts/9/checkin');
  });
});

describe('wellbeing', () => {
  it('loads the dashboard', async () => {
    await getWellbeing();
    expect(api.get).toHaveBeenLastCalledWith('/api/v2/volunteering/wellbeing');
  });

  it('sends share_with_team only when the mood is low, and drops an empty note', async () => {
    await submitWellbeingCheckin({ mood: 2, note: '  tired  ', share_with_team: true });
    expect(api.post).toHaveBeenLastCalledWith('/api/v2/volunteering/wellbeing/checkin', { mood: 2, note: 'tired', share_with_team: true });

    // The website forces the flag off above the low-mood threshold, whatever the box says.
    await submitWellbeingCheckin({ mood: 4, note: '', share_with_team: true });
    expect(api.post).toHaveBeenLastCalledWith('/api/v2/volunteering/wellbeing/checkin', { mood: 4, share_with_team: false });
  });
});

describe('urgent shift requests', () => {
  it('reads the list from data.alerts or a bare array', async () => {
    await getEmergencyAlerts();
    expect(api.get).toHaveBeenLastCalledWith('/api/v2/volunteering/emergency-alerts');
    const alert = { id: 1 } as never;
    expect(emergencyAlertItems({ data: { alerts: [alert] } })).toEqual([alert]);
    expect(emergencyAlertItems({ data: [alert] })).toEqual([alert]);
    expect(emergencyAlertItems({ data: {} })).toEqual([]);
    expect(emergencyAlertItems(null)).toEqual([]);
  });

  it('🔴 answers with the `response` field, not `action`', async () => {
    await respondToEmergencyAlert(5, 'accepted');
    expect(api.put).toHaveBeenLastCalledWith('/api/v2/volunteering/emergency-alerts/5', { response: 'accepted' });
  });
});

describe('qualifications register', () => {
  it('lists, trims on create and update, and withdraws with a reason', async () => {
    await getQualifications();
    expect(api.get).toHaveBeenLastCalledWith('/api/v2/volunteering/qualifications');

    await createQualification({
      qualification_type: 'first_aid',
      title: '  Course  ',
      issuer: '',
      reference_number: ' REF-1 ',
      obtained_at: '2026-01-02',
      expires_at: '',
      notes: null,
    });
    expect(api.post).toHaveBeenLastCalledWith('/api/v2/volunteering/qualifications', {
      qualification_type: 'first_aid',
      title: 'Course',
      issuer: null,
      reference_number: 'REF-1',
      obtained_at: '2026-01-02',
      expires_at: null,
      notes: null,
    });

    await updateQualification(3, {
      qualification_type: 'other', title: 'Thing', issuer: null, reference_number: null, obtained_at: null, expires_at: null, notes: ' n ',
    });
    expect(api.put).toHaveBeenLastCalledWith('/api/v2/volunteering/qualifications/3', expect.objectContaining({ title: 'Thing', notes: 'n' }));

    await withdrawQualification(3, 'no_longer_held');
    expect(api.post).toHaveBeenLastCalledWith('/api/v2/volunteering/qualifications/3/withdraw', { reason: 'no_longer_held' });
  });
});

describe('safeguarding concerns', () => {
  it('loads the report options and the member\'s own reports', async () => {
    await getIncidentReportOptions();
    expect(api.get).toHaveBeenLastCalledWith('/api/v2/volunteering/incidents/report-options');
    await getMyIncidents();
    expect(api.get).toHaveBeenLastCalledWith('/api/v2/volunteering/incidents');
    const item = { id: 1 } as never;
    expect(myIncidentItems({ data: { items: [item], total: 1 } })).toEqual([item]);
    expect(myIncidentItems({ data: [item] })).toEqual([item]);
    expect(myIncidentItems(undefined)).toEqual([]);
  });

  it('sends only the optional fields that were set, as the website does', async () => {
    await reportIncident({
      title: ' A title ',
      description: ' Something happened that worries me. ',
      severity: 'high',
      incident_type: 'concern',
      category: '',
      incident_date: '2026-10-01',
      organization_id: 7,
    });
    expect(api.post).toHaveBeenLastCalledWith('/api/v2/volunteering/incidents', {
      title: 'A title',
      description: 'Something happened that worries me.',
      severity: 'high',
      incident_type: 'concern',
      incident_date: '2026-10-01',
      organization_id: 7,
    });
  });
});

describe('accessibility needs', () => {
  it('replaces the whole set, trimming blanks to null', async () => {
    await updateAccessibilityNeeds([
      { need_type: 'mobility', description: ' step-free ', accommodations_required: '', emergency_contact_name: null, emergency_contact_phone: ' ' },
    ]);
    expect(api.put).toHaveBeenLastCalledWith('/api/v2/volunteering/accessibility-needs', {
      needs: [{ need_type: 'mobility', description: 'step-free', accommodations_required: null, emergency_contact_name: null, emergency_contact_phone: null }],
    });
    await updateAccessibilityNeeds([]);
    expect(api.put).toHaveBeenLastCalledWith('/api/v2/volunteering/accessibility-needs', { needs: [] });
  });
});

describe('group sign-ups', () => {
  it('reserves on the shift, then adds, removes and cancels on the reservation', async () => {
    await getGroupReservations();
    expect(api.get).toHaveBeenLastCalledWith('/api/v2/volunteering/group-reservations');
    await reserveGroupPlaces(12, { group_id: 3, reserved_slots: 4, notes: ' bring gloves ' });
    expect(api.post).toHaveBeenLastCalledWith('/api/v2/volunteering/shifts/12/group-reserve', { group_id: 3, reserved_slots: 4, notes: 'bring gloves' });
    await addGroupReservationMember(8, 21);
    expect(api.post).toHaveBeenLastCalledWith('/api/v2/volunteering/group-reservations/8/members', { user_id: 21 });
    await removeGroupReservationMember(8, 21);
    expect(api.delete).toHaveBeenLastCalledWith('/api/v2/volunteering/group-reservations/8/members/21');
    await cancelGroupReservation(8);
    expect(api.delete).toHaveBeenLastCalledWith('/api/v2/volunteering/group-reservations/8');
  });

  it('keeps only the groups the member runs, like the website', async () => {
    await getMyGroupsForReservation();
    expect(api.get).toHaveBeenLastCalledWith('/api/v2/groups', { member: 'me', per_page: '100' });
    const groups = leadableGroups({
      data: [
        { id: 1, name: 'Mine', owner_id: 7 },
        { id: 2, name: 'Admin of', viewer_membership: { role: 'admin', status: 'active' } },
        { id: 3, name: 'Just a member', viewer_membership: { role: 'member', status: 'active' } },
        { id: 4, name: 'Suspended admin', viewer_membership: { role: 'admin', status: 'banned' } },
      ],
    }, 7);
    expect(groups.map((group) => group.id)).toEqual([1, 2]);
    expect(leadableGroups({ data: { items: [{ id: 5, name: 'x', viewer_membership: { is_admin: true, status: 'active' } }] } }, null).map((g) => g.id)).toEqual([5]);
  });
});

describe('expenses with a receipt', () => {
  it('uploads multipart with the receipt in the `receipt` field and the idempotency key in both places', async () => {
    const appended: [string, unknown][] = [];
    const formDataSpy = jest.spyOn(global, 'FormData').mockImplementation(() => ({
      append: (name: string, value: unknown) => { appended.push([name, value]); },
    }) as unknown as FormData);

    await submitVolunteerExpenseWithReceipt(
      { organization_id: 4, expense_type: 'travel', amount: 12.5, currency: 'EUR', description: 'Bus' },
      { uri: 'file:///tmp/photo.png', mimeType: 'image/png' },
      'mobile-expense-abcdef12',
    );

    expect(api.upload).toHaveBeenCalledWith(
      '/api/v2/volunteering/expenses',
      expect.anything(),
      { headers: { 'Idempotency-Key': 'mobile-expense-abcdef12' } },
    );
    expect(appended).toEqual(expect.arrayContaining([
      ['organization_id', '4'],
      ['expense_type', 'travel'],
      ['amount', '12.5'],
      ['description', 'Bus'],
      ['idempotency_key', 'mobile-expense-abcdef12'],
      ['receipt', { uri: 'file:///tmp/photo.png', name: 'photo.png', type: 'image/png' }],
    ]));
    formDataSpy.mockRestore();
  });
});
