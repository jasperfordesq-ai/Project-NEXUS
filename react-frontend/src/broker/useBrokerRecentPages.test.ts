// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { BROKER_RECENT_STORAGE_KEY, recordBrokerVisit, useBrokerRecentPages } from './useBrokerRecentPages';

function stored(): string[] {
  return JSON.parse(window.localStorage.getItem(BROKER_RECENT_STORAGE_KEY) ?? '[]');
}

describe('recordBrokerVisit', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('remembers broker pages newest first, without the tenant slug', () => {
    recordBrokerVisit('/hour-timebank/broker/members', 'hour-timebank');
    recordBrokerVisit('/hour-timebank/broker/messages/12', 'hour-timebank');
    expect(stored()).toEqual(['/broker/messages/12', '/broker/members']);
  });

  it('keeps each page once, moving a revisited page to the front', () => {
    recordBrokerVisit('/broker/members');
    recordBrokerVisit('/broker/vetting');
    recordBrokerVisit('/broker/members');
    expect(stored()).toEqual(['/broker/members', '/broker/vetting']);
  });

  it('keeps the last six only', () => {
    for (const p of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) recordBrokerVisit(`/broker/${p}`);
    expect(stored()).toEqual(['/broker/g', '/broker/f', '/broker/e', '/broker/d', '/broker/c', '/broker/b']);
  });

  it('ignores the dashboard and anything outside the broker panel', () => {
    recordBrokerVisit('/broker');
    recordBrokerVisit('/broker/');
    recordBrokerVisit('/test/broker', 'test');
    recordBrokerVisit('/dashboard');
    recordBrokerVisit('/brokerage/x');
    expect(stored()).toEqual([]);
  });

  it('survives corrupt storage', () => {
    window.localStorage.setItem(BROKER_RECENT_STORAGE_KEY, '{not json');
    recordBrokerVisit('/broker/members');
    expect(stored()).toEqual(['/broker/members']);
  });
});

describe('useBrokerRecentPages', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('reads what is stored and updates when a visit is recorded', () => {
    window.localStorage.setItem(BROKER_RECENT_STORAGE_KEY, JSON.stringify(['/broker/vetting']));
    const { result } = renderHook(() => useBrokerRecentPages());
    expect(result.current).toEqual(['/broker/vetting']);

    act(() => recordBrokerVisit('/broker/members'));
    expect(result.current).toEqual(['/broker/members', '/broker/vetting']);
  });

  it('returns the same array while nothing changes', () => {
    const { result, rerender } = renderHook(() => useBrokerRecentPages());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
