// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as SecureStore from 'expo-secure-store';
import { storage } from '@/lib/storage';
import {
  completeCourseAuthoringCreationOperation,
  reserveCourseAuthoringCreationOperation,
} from './courseAuthoringCreationOperation';

jest.mock('@/lib/storage', () => ({ storage: { getJson: jest.fn(), get: jest.fn() } }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: jest.fn(async (_algorithm: string, value: string) => `hash-${value}`),
}));

describe('course authoring creation operation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (storage.getJson as jest.Mock).mockResolvedValue({ id: 42 });
    (storage.get as jest.Mock).mockResolvedValue('hour-timebank');
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('reuses the same unfinished key for the same resource intent after a restart', async () => {
    const intent = { section_id: 5, title: 'New lesson', position: 0 };
    const first = await reserveCourseAuthoringCreationOperation('lesson', 42, intent);
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(JSON.stringify(first));

    expect((await reserveCourseAuthoringCreationOperation('lesson', 42, intent)).key).toBe(first.key);
  });

  it('isolates otherwise identical intents by course and resource type', async () => {
    await reserveCourseAuthoringCreationOperation('section', 42, { title: 'Introduction' });
    await reserveCourseAuthoringCreationOperation('lesson', 42, { title: 'Introduction' });
    await reserveCourseAuthoringCreationOperation('section', 43, { title: 'Introduction' });

    const keys = (SecureStore.getItemAsync as jest.Mock).mock.calls.map(([key]) => key);
    expect(new Set(keys).size).toBe(3);
  });

  it('removes the reservation only after the server confirms the resource', async () => {
    const operation = await reserveCourseAuthoringCreationOperation('cohort', 42, { name: 'Autumn' });
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(JSON.stringify(operation));
    await completeCourseAuthoringCreationOperation(operation);

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(operation.storageKey);
  });

  it('refuses an account change before transport', async () => {
    (storage.getJson as jest.Mock).mockResolvedValueOnce({ id: 42 }).mockResolvedValueOnce({ id: 99 });
    await expect(
      reserveCourseAuthoringCreationOperation('question', 42, { quizId: 11, prompt: 'Question' }),
    ).rejects.toThrow('identity changed');
  });
});
