// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const mockStore = new Map<string, string>();
jest.mock('@/lib/storage', () => ({
  storage: {
    get: jest.fn(async (key: string) => mockStore.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => { mockStore.set(key, value); }),
    remove: jest.fn(async (key: string) => { mockStore.delete(key); }),
  },
}));

import {
  forgetTrustedDevice,
  rememberTrustedDevice,
  trustedDeviceAccountKey,
  trustedDeviceTokenFor,
} from './trustedDevices';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

beforeEach(() => mockStore.clear());

it('keys accounts by community and email, ignoring case and spaces', () => {
  expect(trustedDeviceAccountKey(' Acme ', ' Member@Example.TEST ')).toBe('acme|member@example.test');
});

it('keeps one token per account, so trusting a second account never replaces the first', async () => {
  await rememberTrustedDevice('acme|alice@example.test', A);
  await rememberTrustedDevice('acme|bob@example.test', B);
  expect(await trustedDeviceTokenFor('acme|alice@example.test')).toBe(A);
  expect(await trustedDeviceTokenFor('acme|bob@example.test')).toBe(B);
  expect(await trustedDeviceTokenFor('other|alice@example.test')).toBeNull();
});

it('refuses anything that is not a server-issued token', async () => {
  await rememberTrustedDevice('acme|alice@example.test', 'not-a-token');
  await rememberTrustedDevice('acme|alice@example.test', undefined);
  expect(await trustedDeviceTokenFor('acme|alice@example.test')).toBeNull();
});

it('survives a corrupt store and forgets a single account on request', async () => {
  mockStore.set('nexus_trusted_devices', '{not json');
  expect(await trustedDeviceTokenFor('acme|alice@example.test')).toBeNull();
  await rememberTrustedDevice('acme|alice@example.test', A);
  await rememberTrustedDevice('acme|bob@example.test', B);
  await forgetTrustedDevice('acme|alice@example.test');
  expect(await trustedDeviceTokenFor('acme|alice@example.test')).toBeNull();
  expect(await trustedDeviceTokenFor('acme|bob@example.test')).toBe(B);
});
