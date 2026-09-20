// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/eventOfflineCheckin', () => ({
  registerOfflineCheckinDevice: jest.fn(), rotateOfflineCheckinDevice: jest.fn(),
  downloadOfflineCheckinManifest: jest.fn(), getOfflineCheckinWorkspace: jest.fn(),
}));
jest.mock('@/lib/eventOfflineCheckinStore', () => ({
  getPendingOfflineRegistration: jest.fn(), updatePendingOfflineRegistration: jest.fn(),
  completeOfflineRegistration: jest.fn(), loadMobileOfflineSessionForReview: jest.fn(),
  activateMobileOfflineSession: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'rotation-key' }));
import * as api from './api/eventOfflineCheckin';
import * as store from './eventOfflineCheckinStore';
import { recoverOfflineRegistration } from './offlineRegistrationRecovery';

let pending: store.PendingOfflineRegistration | null;
const initial: store.PendingOfflineRegistration = {
  eventId: 91, userId: 41, tenant: 'community', label: 'Door', revision: 1,
  idempotencyKey: 'registration-key', stage: 'register',
};
const device = { id: 22, version: 1, status: 'active' as const };
const workspace = { event_id: 91, devices: [device] } as api.MobileOfflineWorkspace;
const manifest = { event_id: 91, device: { id: 22, version: 1 } } as api.MobileOfflineManifest;
const active = { eventId: 91, deviceId: 22, deviceVersion: 1, deviceSecret: 'nxd1_test', queue: [] } as unknown as store.MobileOfflineSession;

beforeEach(() => {
  jest.resetAllMocks();
  pending = { ...initial };
  jest.mocked(store.getPendingOfflineRegistration).mockImplementation(async () => pending);
  jest.mocked(store.updatePendingOfflineRegistration).mockImplementation(async (previous, next) => {
    pending = { ...next, revision: previous.revision + 1 };
    return pending;
  });
  jest.mocked(store.completeOfflineRegistration).mockImplementation(async () => { pending = null; });
  jest.mocked(api.registerOfflineCheckinDevice).mockResolvedValue({ contract_version: 1, event_id: 91, device: { ...device, secret: 'nxd1_test' } });
  jest.mocked(api.getOfflineCheckinWorkspace).mockResolvedValue(workspace);
  jest.mocked(api.downloadOfflineCheckinManifest).mockResolvedValue(manifest);
  jest.mocked(store.loadMobileOfflineSessionForReview)
    .mockResolvedValueOnce({ session: null, inactive: null })
    .mockResolvedValue({ session: active, inactive: null });
});

it('persists the received secret before downloading and verifies activation before completion', async () => {
  jest.mocked(api.downloadOfflineCheckinManifest).mockImplementation(async () => {
    expect(pending).toMatchObject({ stage: 'activate', secret: 'nxd1_test' });
    return manifest;
  });
  const result = await recoverOfflineRegistration(91, 'resume', () => true);
  expect(api.registerOfflineCheckinDevice).toHaveBeenCalledWith(91, 'Door', 'registration-key');
  expect(store.loadMobileOfflineSessionForReview).toHaveBeenCalledTimes(2);
  expect(result.session).toBe(active);
  expect(pending).toBeNull();
});

it('retains the original request after a lost response and never automatically rotates its replay', async () => {
  jest.mocked(api.registerOfflineCheckinDevice).mockRejectedValueOnce(new Error('response lost'));
  await expect(recoverOfflineRegistration(91, 'resume', () => true)).rejects.toThrow('response lost');
  expect(pending).toEqual(initial);
  jest.mocked(api.registerOfflineCheckinDevice).mockResolvedValue({ contract_version: 1, event_id: 91, device: { ...device, secret: null } });
  expect((await recoverOfflineRegistration(91, 'resume', () => true)).pending?.stage).toBe('reauthorize');
  expect(jest.mocked(api.registerOfflineCheckinDevice).mock.calls[1][2]).toBe('registration-key');
  await recoverOfflineRegistration(91, 'resume', () => true);
  expect(api.rotateOfflineCheckinDevice).not.toHaveBeenCalled();
});

it('persists a rotation request before sending and reuses it after a lost rotation response', async () => {
  pending = { ...initial, stage: 'reauthorize', device: { id: 22, version: 1 } };
  jest.mocked(api.rotateOfflineCheckinDevice).mockImplementationOnce(async () => {
    expect(pending).toMatchObject({ stage: 'rotate', idempotencyKey: 'mobile-offline-rotate-rotation-key' });
    throw new Error('response lost');
  });
  await expect(recoverOfflineRegistration(91, 'reauthorize', () => true)).rejects.toThrow('response lost');
  jest.mocked(api.rotateOfflineCheckinDevice).mockResolvedValue({ contract_version: 1, event_id: 91, device: { ...device, version: 2, secret: null } });
  const result = await recoverOfflineRegistration(91, 'resume', () => true);
  expect(result.pending).toMatchObject({ stage: 'reauthorize', device: { id: 22, version: 2 } });
  expect(jest.mocked(api.rotateOfflineCheckinDevice).mock.calls[1]).toEqual(jest.mocked(api.rotateOfflineCheckinDevice).mock.calls[0]);
  expect(api.registerOfflineCheckinDevice).not.toHaveBeenCalled();
});

it('resumes activation after a manifest failure without registering another device', async () => {
  jest.mocked(api.downloadOfflineCheckinManifest).mockRejectedValueOnce(new Error('offline'));
  await expect(recoverOfflineRegistration(91, 'resume', () => true)).rejects.toThrow('offline');
  expect(pending?.stage).toBe('activate');
  jest.mocked(store.loadMobileOfflineSessionForReview).mockReset()
    .mockResolvedValueOnce({ session: null, inactive: null }).mockResolvedValue({ session: active, inactive: null });
  await recoverOfflineRegistration(91, 'resume', () => true);
  expect(api.registerOfflineCheckinDevice).toHaveBeenCalledTimes(1);
});

it('preserves an existing queue when only completion recording had failed', async () => {
  pending = { ...initial, stage: 'activate', device: { id: 22, version: 1 }, secret: 'nxd1_test' };
  const queued = { ...active, queue: [{ clientNonce: 'keep-me' }] } as store.MobileOfflineSession;
  jest.mocked(store.loadMobileOfflineSessionForReview).mockReset().mockResolvedValue({ session: queued, inactive: null });
  expect((await recoverOfflineRegistration(91, 'resume', () => true)).session).toBe(queued);
  expect(store.activateMobileOfflineSession).not.toHaveBeenCalled();
  expect(api.downloadOfflineCheckinManifest).not.toHaveBeenCalled();
});

it('refuses to rotate a device with an existing local session', async () => {
  pending = { ...initial, stage: 'reauthorize', device: { id: 22, version: 1 } };
  jest.mocked(store.loadMobileOfflineSessionForReview).mockReset().mockResolvedValue({ session: active, inactive: 'manifest_expired' });
  await expect(recoverOfflineRegistration(91, 'reauthorize', () => true)).rejects.toThrow('existing_session');
  expect(api.rotateOfflineCheckinDevice).not.toHaveBeenCalled();
});

it('retains recovery when activation cannot be read back', async () => {
  jest.mocked(store.loadMobileOfflineSessionForReview).mockReset().mockResolvedValue({ session: null, inactive: null });
  await expect(recoverOfflineRegistration(91, 'resume', () => true)).rejects.toThrow('activation_unverified');
  expect(store.completeOfflineRegistration).not.toHaveBeenCalled();
  expect(pending?.stage).toBe('activate');
});

it('does not dispatch after the screen leaves during pending-record loading', async () => {
  await expect(recoverOfflineRegistration(91, 'resume', () => false)).rejects.toThrow('changed');
  expect(api.registerOfflineCheckinDevice).not.toHaveBeenCalled();
});

it('does not continue manifest work if the returned secret cannot be persisted', async () => {
  jest.mocked(store.updatePendingOfflineRegistration).mockRejectedValueOnce(new Error('disk full'));
  await expect(recoverOfflineRegistration(91, 'resume', () => true)).rejects.toThrow('disk full');
  expect(api.getOfflineCheckinWorkspace).not.toHaveBeenCalled();
  expect(api.downloadOfflineCheckinManifest).not.toHaveBeenCalled();
  expect(pending).toEqual(initial);
});

it('rejects a response for another event without saving its device secret', async () => {
  jest.mocked(api.registerOfflineCheckinDevice).mockResolvedValue({ contract_version: 1, event_id: 92, device: { ...device, secret: 'nxd1_test' } });
  await expect(recoverOfflineRegistration(91, 'resume', () => true)).rejects.toThrow('response_mismatch');
  expect(store.updatePendingOfflineRegistration).not.toHaveBeenCalled();
});

it('does not save a response after departure or a replaced pending operation', async () => {
  jest.mocked(api.registerOfflineCheckinDevice).mockImplementationOnce(async () => {
    pending = { ...initial, idempotencyKey: 'replacement' };
    return { contract_version: 1, event_id: 91, device: { ...device, secret: 'nxd1_test' } };
  });
  await expect(recoverOfflineRegistration(91, 'resume', () => true)).rejects.toThrow('changed');
  expect(store.updatePendingOfflineRegistration).not.toHaveBeenCalled();
  expect(store.activateMobileOfflineSession).not.toHaveBeenCalled();
});
