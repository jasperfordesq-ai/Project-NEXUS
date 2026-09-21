// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as SecureStore from 'expo-secure-store';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { storage } from '@/lib/storage';
import { mutationIdempotencyKey } from '@/lib/utils/idempotencyKey';
import { reserveCourseAuthoringCreationOperation } from './courseAuthoringCreationOperation';
import { reserveCourseCreationOperation } from './courseCreationOperation';
import { reserveGoalCreationOperation } from './goalCreationOperation';
import { reserveJobHiringActionOperation } from './jobHiringActionOperation';
import { reserveMarketplaceListingOperation } from './marketplaceListingOperation';
import { reservePodcastCreationOperation } from './podcastCreationOperation';
import { reservePollCreationOperation } from './pollCreationOperation';
import { reserveShiftSwapRequestOperation } from './shiftSwapRequestOperation';
import { reserveVolunteerOpportunityCreationOperation } from './volunteerOpportunityCreationOperation';

jest.mock('expo-secure-store');
jest.mock('expo-crypto');
jest.mock('@/lib/storage');
jest.mock('@/lib/utils/idempotencyKey', () => ({ mutationIdempotencyKey: jest.fn() }));

const persisted = new Map<string, string>();
let keySequence = 0;

beforeEach(() => {
  persisted.clear();
  keySequence = 0;
  jest.clearAllMocks();
  jest.mocked(mutationIdempotencyKey).mockImplementation(prefix => `${prefix}-${++keySequence}`);
  jest.mocked(digestStringAsync).mockImplementation(async (_algorithm: CryptoDigestAlgorithm, value: string) => {
    const checksum = [...value].reduce((total, character) => (total * 33 + character.charCodeAt(0)) >>> 0, 5381);
    return `${value.length}-${checksum}`;
  });
  jest.mocked(storage.getJson).mockResolvedValue({ id: 41 });
  jest.mocked(storage.get).mockResolvedValue('hour-timebank');
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async key => persisted.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { persisted.set(key, value); });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async key => { persisted.delete(key); });
});

const operations: [string, (intent: string) => Promise<{ key: string } >][] = [
  ['courseAuthoringCreation', (intent: string) => reserveCourseAuthoringCreationOperation('lesson', 7, intent)],
  ['courseCreation', reserveCourseCreationOperation],
  ['goalCreation', reserveGoalCreationOperation],
  ['jobHiringAction', reserveJobHiringActionOperation],
  ['marketplaceListing', reserveMarketplaceListingOperation],
  ['podcastCreation', reservePodcastCreationOperation],
  ['pollCreation', reservePollCreationOperation],
  ['shiftSwapRequest', reserveShiftSwapRequestOperation],
  ['volunteerOpportunityCreation', reserveVolunteerOpportunityCreationOperation],
];

describe.each(operations)('%s concurrent reservation identity', (_name, reserve) => {
  it.each(['account', 'community'])('rejects both callers after %s replacement and preserves the original retry', async replacement => {
    let release!: (value: string | null) => void;
    jest.mocked(SecureStore.getItemAsync).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = reserve(`pending ${replacement}`);
    const second = reserve(`pending ${replacement}`);
    const outcomes = Promise.allSettled([first, second]);
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
    expect(SecureStore.getItemAsync).toHaveBeenCalledTimes(1);
    if (replacement === 'account') jest.mocked(storage.getJson).mockResolvedValue({ id: 99 });
    else jest.mocked(storage.get).mockResolvedValue('another-community');
    release(null);
    expect((await outcomes).map(result => result.status)).toEqual(['rejected', 'rejected']);
    expect(persisted.size).toBe(1);
    const original = JSON.parse([...persisted.values()][0]) as { key: string };
    jest.mocked(storage.getJson).mockResolvedValue({ id: 41 });
    jest.mocked(storage.get).mockResolvedValue('hour-timebank');
    expect((await reserve(`pending ${replacement}`)).key).toBe(original.key);
  });
});
