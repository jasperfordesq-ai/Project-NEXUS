// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderEventComponent } from '@/test/events-test-harness';
import { eventOfflineCheckinApi, type OfflineCheckinWorkspace } from '@/lib/event-offline-checkin-api';
import { loadOfflineCheckinSession } from '@/lib/event-offline-checkin-store';
import { EventOfflineCheckinWorkspace } from './EventOfflineCheckinWorkspace';

const mockToast = vi.hoisted(() => ({
  success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(),
}));

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => mockToast }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('react-i18next', () => {
  const labels: Record<string, string> = {
    'workspace.title': 'Offline QR check-in',
    'workspace.loading': 'Loading offline check-in',
    'workspace.load_error_title': 'Offline check-in is unavailable',
    'workspace.load_error_description': 'Secure workspace unavailable.',
    'workspace.retry': 'Try again',
    'workspace.privacy_title': 'Privacy boundary',
    'workspace.privacy_body': 'Private.',
    'workspace.manual_required': 'Manual entry remains available.',
    'workspace.no_wallet': 'No wallet effects.',
    'workspace.online': 'Online',
    'workspace.offline': 'Offline',
    'workspace.offline_ready': 'Ready.',
    'workspace.offline_not_ready': 'Not ready.',
    'device.title': 'Authorized devices',
    'device.description': 'Device description',
    'device.label': 'Device label',
    'device.label_hint': 'Recognizable label',
    'device.register': 'Authorize device',
    'device.reason': 'Revocation reason',
    'device.reason_hint': 'No member details',
    'device.empty': 'No devices.',
    'conflicts.title': 'Check-in conflicts',
    'conflicts.description': 'Review conflicts.',
    'conflicts.empty': 'No conflicts.',
    'manual.title': 'Manual name fallback',
    'manual.description': 'Search by name.',
  };
  return {
    useTranslation: () => ({
      t: (key: string) => labels[key] ?? key,
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
  EventCheckInWorkspace: () => <div>live-name-fallback</div>,
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

describe('EventOfflineCheckinWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadOfflineCheckinSession).mockResolvedValue(null);
    vi.mocked(eventOfflineCheckinApi.conflicts).mockResolvedValue({
      success: true,
      data: {
        contract_version: 1,
        event_id: 42,
        items: [],
        total: 0,
        page: 1,
        per_page: 25,
        privacy: {
          credential_redacted: true,
          contact_fields_redacted: true,
          free_text_member_profile_redacted: true,
        },
      },
    });
  });

  it('keeps the live manual name fallback visible when no offline device is authorized', async () => {
    vi.mocked(eventOfflineCheckinApi.workspace).mockResolvedValue({
      success: true,
      data: workspaceFixture,
    });

    renderEventComponent(<EventOfflineCheckinWorkspace eventId={42} />);

    expect(await screen.findByText('Offline QR check-in')).toBeInTheDocument();
    expect(screen.getByText('live-name-fallback')).toBeInTheDocument();
    expect(screen.getByLabelText('Device label')).toBeInTheDocument();
  });

  it('falls back to the live name workspace when the secure API cannot load', async () => {
    vi.mocked(eventOfflineCheckinApi.workspace).mockResolvedValue({
      success: false,
      code: 'EVENT_CHECKIN_FORBIDDEN',
    });

    renderEventComponent(<EventOfflineCheckinWorkspace eventId={42} />);

    await waitFor(() => expect(screen.getByText('Offline check-in is unavailable')).toBeInTheDocument());
    expect(screen.getByText('live-name-fallback')).toBeInTheDocument();
  });

  it('pages through every open offline conflict', async () => {
    const user = userEvent.setup();
    vi.mocked(eventOfflineCheckinApi.workspace).mockResolvedValue({
      success: true,
      data: { ...workspaceFixture, open_conflicts: 26 },
    });
    vi.mocked(eventOfflineCheckinApi.conflicts)
      .mockResolvedValueOnce({
        success: true,
        data: {
          contract_version: 1,
          event_id: 42,
          items: [],
          total: 26,
          page: 1,
          per_page: 25,
          privacy: {
            credential_redacted: true,
            contact_fields_redacted: true,
            free_text_member_profile_redacted: true,
          },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          contract_version: 1,
          event_id: 42,
          items: [],
          total: 26,
          page: 2,
          per_page: 25,
          privacy: {
            credential_redacted: true,
            contact_fields_redacted: true,
            free_text_member_profile_redacted: true,
          },
        },
      });
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

    await user.type(await screen.findByLabelText('Device label'), 'Front desk');
    await user.click(screen.getByRole('button', { name: 'Authorize device' }));

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

    await user.type(await screen.findByLabelText('Device label'), 'Front desk');
    await user.click(screen.getByRole('button', { name: 'Authorize device' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('errors.generic'));
  });
});
