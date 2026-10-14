// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { afterEach, describe, expect, it } from 'vitest';
import {
  clearComposer,
  composerStorageKey,
  contentSignature,
  initialComposerValues,
  keyFor,
  loadComposer,
  saveComposer,
  scheduleSignature,
  type KeyLedger,
} from './composerSession';

describe('keyFor', () => {
  it('replays the same key while the payload is unchanged and issues a new one when it changes', () => {
    let counter = 0;
    const make = () => `key-${++counter}`;
    const ledger: KeyLedger = {};
    const first = keyFor(ledger, 'create', 'a', make);
    expect(keyFor(ledger, 'create', 'a', make)).toBe(first);
    const second = keyFor(ledger, 'create', 'b', make);
    expect(second).not.toBe(first);
    expect(keyFor(ledger, 'create', 'b', make)).toBe(second);
  });

  it('keeps separate operations separate', () => {
    const ledger: KeyLedger = {};
    const create = keyFor(ledger, 'create', 'x');
    const schedule = keyFor(ledger, 'schedule', 'x');
    expect(create).not.toBe(schedule);
  });

  it('builds stable signatures', () => {
    expect(contentSignature({ variant: 'announcement', segments: ['waitlist_active', 'registration_confirmed'], channels: ['in_app', 'email'], body: 'Hi' }))
      .toBe(contentSignature({ variant: 'announcement', segments: ['registration_confirmed', 'waitlist_active'], channels: ['email', 'in_app'], body: 'Hi' }));
    expect(scheduleSignature(8, null)).toBe('8|now');
    expect(scheduleSignature(8, '2030-06-01T09:30:00.000Z')).toBe('8|2030-06-01T09:30:00.000Z');
  });
});

describe('composer persistence', () => {
  afterEach(() => window.sessionStorage.clear());

  it('round-trips a draft and its keys', () => {
    const values = { ...initialComposerValues(), body: 'Doors open at seven.' };
    saveComposer(42, { values, mode: 'new', sourceId: null, session: { create: { signature: 's', key: 'k' } } });
    expect(loadComposer(42)).toEqual({ values, mode: 'new', sourceId: null, session: { create: { signature: 's', key: 'k' } } });
    clearComposer(42);
    expect(loadComposer(42)).toBeNull();
  });

  it('ignores damaged or foreign data', () => {
    window.sessionStorage.setItem(composerStorageKey(42), '{not json');
    expect(loadComposer(42)).toBeNull();
    window.sessionStorage.setItem(composerStorageKey(42), JSON.stringify({ values: { variant: 'spam' } }));
    expect(loadComposer(42)).toBeNull();
  });
});
