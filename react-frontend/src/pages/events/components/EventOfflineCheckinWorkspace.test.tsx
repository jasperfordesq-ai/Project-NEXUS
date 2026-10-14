// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderEventComponent } from '@/test/events-test-harness';
import { eventOfflineCheckinApi, type OfflineCheckinConflicts, type OfflineCheckinWorkspace } from '@/lib/event-offline-checkin-api';
import {
  enqueueOfflineCredential,
  loadOfflineCheckinSession,
  synchronizeOfflineCheckin,
  type OfflineCheckinSession,
} from '@/lib/event-offline-checkin-store';
import { getFormattingLocale } from '@/lib/helpers';
import { EventOfflineCheckinWorkspace } from './EventOfflineCheckinWorkspace';

const mockToast = vi.hoisted(() => ({
  success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(),
}));

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => mockToast }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('react-i18next', () => {
  const labels: Record<string, string> = {
    'workspace.title': 'Check in attendees',
    'workspace.loading': 'Loading check-in',
    'workspace.load_error_title': 'Code scanning and offline mode are unavailable',
    'workspace.load_error_description': 'You can still check people in by name below.',
    'workspace.retry': 'Try again',
    'workspace.credits': 'If this event offers a time-credit reward for attending, it is given when the person is first checked in.',
    'workspace.online': 'Online',
    'workspace.offline': 'No internet',
    'workspace.offline_ready': 'Ready.',
    'workspace.offline_not_ready': 'Not set up.',
    'guide.title': 'How check-in works',
    'sections.by_name': '1. Check in by name',
    'sections.scan': '2. Scan a check-in code',
    'sections.offline': '3. Without internet (offline mode)',
    'sections.offline_badge': 'Only needed when there is no internet',
    'device.title': 'Devices set up for this event',
    'device.description': 'Device description',
    'device.label': 'Name for this device',
    'device.label_hint': 'Recognizable label',
    'device.register': 'Set this device up',
    'device.reason': 'Why are you stopping it?',
    'device.reason_hint': 'No member details',
    'device.empty': 'No devices.',
    'conflicts.title': 'Disagreements to review',
    'conflicts.description': 'Review conflicts.',
    'conflicts.empty': 'Nothing to review.',
    'conflicts.current_state': 'Server record now: {{state}}',
    'conflicts.offline_action': 'Recorded on the device: {{action}}',
    'conflicts.observed': 'Recorded {{date}}',
    'scan.operations.check_out': 'Left (check out)',
    'scan.code_label': 'Check-in code',
    'scan.queue': 'Record this code',
    'scan.sent': '{{name}} was recorded.',
    'scan.saved_offline': '{{name}} was saved on this device.',
    'events:manage.people.states.attendance.checked_out': 'Checked out',
  };
  return {
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => {
        let value = labels[key] ?? key;
        for (const [name, replacement] of Object.entries(options ?? {})) {
          value = value.replace(`{{${name}}}`, String(replacement));
        }
        return value;
      },
      i18n: { language: 'en' },
    }),
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});
vi.mock('@/components/ui/ConfirmDialog', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui/ConfirmDialog')>('@/components/ui/ConfirmDialog');
  return { ...actual, useConfirm: () => vi.fn().mockResolvedValue(false) };
});
vi.mock('./EventCheckInWorkspace', () => ({
  EventCheckInWorkspace: () => <div>live-name-roster</div>,
}));
vi.mock('@/lib/event-offline-checkin-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/event-offline-checkin-api')>('@/lib/event-offline-checkin-api');
  return {
    ...actual,
    eventOfflineCheckinApi: {
      workspace: vi.fn(),
      conflicts: vi.fn(),
      manifest: vi.fn(),
      registerDevice: vi.fn(),
      rotateDevice: vi.fn(),
      revokeDevice: vi.fn(),
      resolveConflict: vi.fn(),
    },
  };
});
vi.mock('@/lib/event-offline-checkin-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/event-offline-checkin-store')>('@/lib/event-offline-checkin-store');
  return {
    ...actual,
    loadOfflineCheckinSession: vi.fn(),
    enqueueOfflineCredential: vi.fn(),
    synchronizeOfflineCheckin: vi.fn(),
    purgeOfflineCheckinSession: vi.fn().mockResolvedValue(undefined),
  };
});

const workspaceFixture: OfflineCheckinWorkspace = {
  contract_version: 1,
  event_id: 42,
  occurrence_key: 'event:42:occurrence:test',
  manifest_version: 1,
  limits: { replay_window_minutes: 1_440, batch_max_items: 500 },
  devices: [],
  recent_batches: [],
  open_conflicts: 0,
  permissions: {
    manage_devices: true,
    download_manifest: true,
    sync_offline_queue: true,
    resolve_conflicts: true,
    manual_fallback_required: true,
  },
  privacy: {
    device_secrets_redacted: true,
    credential_secrets_redacted: true,
    contact_fields_redacted: true,
    wallet_effects_supported: false,
  },
};

function conflictsPage(items: OfflineCheckinConflicts['items'], total: number, page: number): OfflineCheckinConflicts {
  return {
    contract_version: 1,
    event_id: 42,
    items,
    total,
    page,
    per_page: 25,
    privacy: {
      credential_redacted: true,
      contact_fields_redacted: true,
      free_text_member_profile_redacted: true,
    },
  };
}

describe('EventOfflineCheckinWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadOfflineCheckinSession).mockResolvedValue(null);
    vi.mocked(eventOfflineCheckinApi.conflicts).mockResolvedValue({
      success: true,
      data: conflictsPage([], 0, 1),
    });
  });

  it('puts check-in by name first, code scanning second and offline mode last (E-105)', async () => {
    vi.mocked(eventOfflineCheckinApi.workspace).mockResolvedValue({
      success: true,
      data: workspaceFixture,
    });

    renderEventComponent(<EventOfflineCheckinWorkspace eventId={42} />);

    expect(await screen.findByText('Check in attendees')).toBeInTheDocument();
    const byName = screen.getByRole('heading', { name: '1. Check in by name' });
    const scan = screen.getByRole('heading', { name: '2. Scan a check-in code' });
    const offline = screen.getByRole('heading', { name: '3. Without internet (offline mode)' });
    expect(byName.compareDocumentPosition(scan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(scan.compareDocumentPosition(offline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('live-name-roster')).toBeInTheDocument();
    expect(screen.getByText('Only needed when there is no internet')).toBeInTheDocument();
    expect(screen.getByText('How check-in works')).toBeInTheDocument();
    expect(screen.getByLabelText('Name for this device')).toBeInTheDocument();
  });

  it('never claims attendance cannot change balances (E-105)', async () => {
    vi.mocked(eventOfflineCheckinApi.workspace).mockResolvedValue({ success: true, data: workspaceFixture });

    renderEventComponent(<EventOfflineCheckinWorkspace eventId={42} />);

    await screen.findByText('Check in attendees');
    expect(screen.queryByText(/never changes balances/i)).not.toBeInTheDocument();
    expect(screen.getByText(/time-credit reward/)).toBeInTheDocument();
  });

  it('still offers check-in by name when the code/offline API cannot load', async () => {
    vi.mocked(eventOfflineCheckinApi.workspace).mockResolvedValue({
      success: false,
      code: 'EVENT_CHECKIN_FORBIDDEN',
    });

    renderEventComponent(<EventOfflineCheckinWorkspace eventId={42} />);

    await waitFor(() => expect(screen.getByText('Code scanning and offline mode are unavailable')).toBeInTheDocument());
    expect(screen.getByText('live-name-roster')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '1. Check in by name' })).toBeInTheDocument();
  });

  it('shows a disagreement in plain words with the server state translated and the time in UTC (E-105)', async () => {
    vi.mocked(eventOfflineCheckinApi.workspace).mockResolvedValue({
      success: true,
      data: { ...workspaceFixture, open_conflicts: 1 },
    });
    vi.mocked(eventOfflineCheckinApi.conflicts).mockResolvedValue({
      success: true,
      data: conflictsPage([{
        item_id: 6,
        batch_id: 6,
        client_batch_id: 'web-1',
        member: { id: 1004334, display_name: 'Ben Member' },
        operation: 'check_out',
        observed_at: '2026-10-13 19:38:38',
        submitted_reason: null,
        expected_attendance_version: 5,
        current_attendance: { state: 'checked_out', version: 6 },
        conflict: { decision_version: 1, code: 'event_attendance_version_conflict', decided_at: '2026-10-13 19:39:02' },
        device: { id: 11, label: 'Front desk' },
      }], 1, 1),
    });

    renderEventComponent(<EventOfflineCheckinWorkspace eventId={42} />);

    expect(await screen.findByText('Server record now: Checked out')).toBeInTheDocument();
    expect(screen.getByText('Recorded on the device: Left (check out)')).toBeInTheDocument();
    // The bare timestamp is UTC; it must not be shifted by the browser's zone.
    const expected = new Intl.DateTimeFormat(getFormattingLocale(), { dateStyle: 'medium', timeStyle: 'short' })
      .format(new Date('2026-10-13T19:38:38Z'));
    expect(screen.getByText((text) => text.includes(`Recorded ${expected}`))).toBeInTheDocument();
    expect(screen.queryByText(/checked_out/)).not.toBeInTheDocument();
  });

  it('pages through every open disagreement', async () => {
    const user = userEvent.setup();
    vi.mocked(eventOfflineCheckinApi.workspace).mockResolvedValue({
      success: true,
      data: { ...workspaceFixture, open_conflicts: 26 },
    });
    vi.mocked(eventOfflineCheckinApi.conflicts)
      .mockResolvedValueOnce({ success: true, data: conflictsPage([], 26, 1) })
      .mockResolvedValueOnce({ success: true, data: conflictsPage([], 26, 2) });
    renderEventComponent(<EventOfflineCheckinWorkspace eventId={42} />);

    await user.click(await screen.findByText('2'));

    await waitFor(() => expect(eventOfflineCheckinApi.conflicts).toHaveBeenLastCalledWith(42, 2));
  });

  it("shows the server's explanation when it says why a device was refused", async () => {
    const user = userEvent.setup();
    const explanation = 'This check-in device has been revoked or replaced. Register the device again to continue.';
    vi.mocked(eventOfflineCheckinApi.workspace).mockResolvedValue({ success: true, data: workspaceFixture });
    vi.mocked(eventOfflineCheckinApi.registerDevice).mockResolvedValue({ success: true, data: {
      contract_version: 1,
      event_id: 42,
      device: { id: 7, label: 'Front desk', version: 1, status: 'active', expires_at: '2035-01-01T00:00:00Z', secret: 'nxd1_secret', secret_one_shot: true },
      manifest_version: 1,
    } });
    vi.mocked(eventOfflineCheckinApi.manifest).mockResolvedValue({
      success: false,
      code: 'EVENT_CHECKIN_VALIDATION_FAILED',
      errors: [{ code: 'EVENT_CHECKIN_VALIDATION_FAILED', message: explanation, reason: 'event_checkin_device_not_active' }],
    });
    renderEventComponent(<EventOfflineCheckinWorkspace eventId={42} />);

    await user.type(await screen.findByLabelText('Name for this device'), 'Front desk');
    await user.click(screen.getByRole('button', { name: 'Set this device up' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(explanation));
  });

  it('keeps its own wording when the refusal carries no explanation', async () => {
    const user = userEvent.setup();
    vi.mocked(eventOfflineCheckinApi.workspace).mockResolvedValue({ success: true, data: workspaceFixture });
    vi.mocked(eventOfflineCheckinApi.registerDevice).mockResolvedValue({
      success: false,
      code: 'EVENT_CHECKIN_FORBIDDEN',
      errors: [{ code: 'EVENT_CHECKIN_FORBIDDEN', message: 'Forbidden' }],
    });
    renderEventComponent(<EventOfflineCheckinWorkspace eventId={42} />);

    await user.type(await screen.findByLabelText('Name for this device'), 'Front desk');
    await user.click(screen.getByRole('button', { name: 'Set this device up' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('errors.generic'));
  });
  describe('a scanned code (E-105 bug 3)', () => {
    const device = {
      id: 7, public_id: '00000000-0000-4000-8000-000000000007', label: 'Front desk', registered_by_user_id: 1,
      version: 1, status: 'active' as const, registered_at: '2026-10-14T10:00:00Z', expires_at: '2035-01-01T00:00:00Z',
      rotated_at: null, revoked_at: null,
    } as unknown as OfflineCheckinWorkspace['devices'][number];
    const item = {
      clientNonce: 'n-1', registrationId: 1, userId: 5, displayName: 'Ben Attendee', operation: 'check_in' as const,
      observedAt: '2026-10-14T10:05:00Z', expectedAttendanceVersion: 0, credentialFingerprint: 'f', credentialHashReference: 'h',
      reason: null, state: 'pending' as const, code: null, decisionVersion: null,
    };
    const session = {
      sessionGeneration: null, eventId: 42, deviceId: 7, deviceVersion: 1, deviceSecret: 'nxd1_secret',
      manifest: { manifest_version: 1, expires_at: '2035-01-01T00:00:00Z' } as unknown as OfflineCheckinSession['manifest'],
      queue: [], activeBatchId: null, activeBatchNonces: [], updatedAt: '2026-10-14T10:00:00Z',
    } as OfflineCheckinSession;
    const queued = { ...session, queue: [item] } as OfflineCheckinSession;

    beforeEach(() => {
      vi.mocked(eventOfflineCheckinApi.workspace).mockResolvedValue({ success: true, data: { ...workspaceFixture, devices: [device] } });
      vi.mocked(loadOfflineCheckinSession).mockResolvedValue(session);
      vi.mocked(enqueueOfflineCredential).mockResolvedValue(queued);
    });

    it('is sent to the server straight away when the device is online', async () => {
      const user = userEvent.setup();
      vi.mocked(synchronizeOfflineCheckin).mockResolvedValue({
        session: { ...queued, queue: [{ ...item, state: 'synced' as const }] } as OfflineCheckinSession,
        batch: null,
      });
      renderEventComponent(<EventOfflineCheckinWorkspace eventId={42} />);

      await user.type(await screen.findByLabelText('Check-in code'), 'nqx2_code');
      await user.click(screen.getByRole('button', { name: 'Record this code' }));

      await waitFor(() => expect(synchronizeOfflineCheckin).toHaveBeenCalledWith(queued));
      expect(mockToast.success).toHaveBeenCalledWith('Ben Attendee was recorded.');
    });

    it('stays saved on the device, without a send attempt, when there is no internet', async () => {
      const user = userEvent.setup();
      const onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      try {
        renderEventComponent(<EventOfflineCheckinWorkspace eventId={42} />);

        await user.type(await screen.findByLabelText('Check-in code'), 'nqx2_code');
        await user.click(screen.getByRole('button', { name: 'Record this code' }));

        await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Ben Attendee was saved on this device.'));
        expect(synchronizeOfflineCheckin).not.toHaveBeenCalled();
      } finally {
        onLine.mockRestore();
      }
    });
  });
});
