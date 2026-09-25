// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as SecureStore from 'expo-secure-store';
import { storage } from '@/lib/storage';
import {
  completeFederationMessageCreationOperation,
  reserveFederationMessageCreationOperation,
} from './federationMessageCreationOperation';

jest.mock('@/lib/storage', () => ({ storage: { getJson: jest.fn(), get: jest.fn() } }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: jest.fn(async (_algorithm: string, value: string) => `hash-${value}`),
}));

describe('federation message creation operation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (storage.getJson as jest.Mock).mockResolvedValue({ id: 42 });
    (storage.get as jest.Mock).mockResolvedValue('hour-timebank');
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('reuses an unfinished encrypted operation after process restart', async () => {
    const first = await reserveFederationMessageCreationOperation('{"title":"Cross-community hello"}');
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(JSON.stringify(first));
    expect((await reserveFederationMessageCreationOperation('{"title":"Cross-community hello"}')).key).toBe(first.key);
  });

  it('uses a different reservation when the submitted content changes', async () => {
    const first = await reserveFederationMessageCreationOperation('{"title":"Cross-community hello"}');
    const changed = await reserveFederationMessageCreationOperation('{"title":"Changed cross-community hello"}');
    expect(changed.storageKey).not.toBe(first.storageKey);
  });

  it('removes the reservation only after confirmed server success', async () => {
    const operation = await reserveFederationMessageCreationOperation('{"title":"Cross-community hello"}');
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(JSON.stringify(operation));
    await completeFederationMessageCreationOperation(operation);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(operation.storageKey);
  });

  it('refuses a tenant or account change before transport', async () => {
    (storage.getJson as jest.Mock).mockResolvedValueOnce({ id: 42 }).mockResolvedValueOnce({ id: 99 });
    await expect(reserveFederationMessageCreationOperation('{"title":"Private message"}')).rejects.toThrow('identity changed');
  });
});
