// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildReturnTarget,
  clearAuthReturn,
  consumeAuthReturn,
  explicitAuthReturn,
  rememberAuthReturn,
  resolveAuthReturn,
} from './auth-return';

afterEach(() => {
  clearAuthReturn();
  vi.useRealTimers();
});

describe('buildReturnTarget', () => {
  it('carries the destination in the address and in router state', () => {
    expect(buildReturnTarget('/hour-timebank/login', '/hour-timebank/exchanges/42?tab=chat#m5')).toEqual({
      to: '/hour-timebank/login?next=%2Fhour-timebank%2Fexchanges%2F42%3Ftab%3Dchat%23m5',
      state: { from: '/hour-timebank/exchanges/42?tab=chat#m5' },
    });
  });

  it.each(['https://evil.test/x', '//evil.test', undefined, ''])('drops an unsafe destination %s', from => {
    expect(buildReturnTarget('/login', from)).toEqual({ to: '/login' });
  });
});

describe('resolveAuthReturn', () => {
  it('prefers router state over the address', () => {
    expect(resolveAuthReturn({ from: '/a' }, '?next=%2Fb', '/feed')).toBe('/a');
  });

  it('reads the ?next= parameter when router state is gone', () => {
    expect(resolveAuthReturn(null, '?next=%2Fcommunity%2Flistings%2F7%3Fx%3D1', '/feed')).toBe('/community/listings/7?x=1');
  });

  it('round-trips the address built by buildReturnTarget', () => {
    const target = buildReturnTarget('/c/login', '/c/admin/users?page=2');
    const search = target.to.slice(target.to.indexOf('?'));
    expect(resolveAuthReturn(null, search, '/feed')).toBe('/c/admin/users?page=2');
  });

  it.each(['?next=https%3A%2F%2Fevil.test', '?next=%2F%2Fevil.test', '?next=javascript%3Aalert(1)'])('refuses an off-site ?next= (%s)', search => {
    expect(resolveAuthReturn(undefined, search, '/feed')).toBe('/feed');
  });

  it('falls back to the stored destination, then to the default', () => {
    expect(resolveAuthReturn(null, '', '/feed')).toBe('/feed');
    rememberAuthReturn('/c/events/9');
    expect(resolveAuthReturn(null, '', '/feed')).toBe('/c/events/9');
  });
});

describe('explicitAuthReturn', () => {
  it('ignores the stored destination, so visiting login never renews it', () => {
    rememberAuthReturn('/c/events/9');
    expect(explicitAuthReturn(null, '')).toBe('');
    expect(explicitAuthReturn(null, '?next=%2Fc%2Fwallet')).toBe('/c/wallet');
  });
});

describe('stored destination', () => {
  it('is used once and then forgotten', () => {
    rememberAuthReturn('/c/messages/3');
    expect(consumeAuthReturn('/c/dashboard')).toBe('/c/messages/3');
    expect(consumeAuthReturn('/c/dashboard')).toBe('/c/dashboard');
  });

  it('never stores an off-site destination', () => {
    rememberAuthReturn('https://evil.test');
    expect(consumeAuthReturn('/c/dashboard')).toBe('/c/dashboard');
  });

  it('expires when abandoned', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T10:00:00Z'));
    rememberAuthReturn('/c/listings/1');
    vi.setSystemTime(new Date('2026-10-27T10:31:00Z'));
    expect(consumeAuthReturn('/c/dashboard')).toBe('/c/dashboard');
  });
});
