// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createMockContexts } from '@/test/mock-contexts';
import type { User } from '@/types/api';

const { mockAdminEnterprise } = vi.hoisted(() => ({
  mockAdminEnterprise: {
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    resetConfig: vi.fn(),
  },
}));
const mockAuthState = vi.hoisted(() => ({ user: null as User | null }));

vi.mock('@/admin/api/adminApi', () => ({ adminEnterprise: mockAdminEnterprise }));
vi.mock('../../api/adminApi', () => ({ adminEnterprise: mockAdminEnterprise }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: mockAuthState.user,
      isAuthenticated: mockAuthState.user !== null,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
  })
);

const makeConfig = (overrides = {}) => ({
  site_name: 'My Timebank',
  site_description: '',
  contact_email: 'admin@timebank.ie',
  contact_phone: '',
  timezone: 'UTC',
  footer_text: '',
  locale: 'en',
  registration_enabled: true,
  require_approval: false,
  require_email_verification: true,
  maintenance_mode: false,
  onboarding_enabled: true,
  starting_balance: 0,
  max_transaction: 0,
  currency_name: 'Hours',
  currency_symbol: 'h',
  auto_approve_listings: true,
  auto_approve_blog: false,
  max_listing_images: 5,
  profanity_filter: false,
  email_notifications_enabled: true,
  push_notifications_enabled: true,
  digest_frequency: 'monthly',
  max_listings_per_user: 0,
  max_groups_per_user: 0,
  max_file_upload_mb: 10,
  ...overrides,
});

async function loadHook() {
  const { useSystemConfigForm } = await import('./useSystemConfigForm');
  const hook = renderHook(() => useSystemConfigForm());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe('useSystemConfigForm', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuthState.user = null;
    mockAdminEnterprise.getConfig.mockResolvedValue({ success: true, data: makeConfig({ timezone: 'Europe/Dublin', starting_balance: '5' }) });
    mockAdminEnterprise.updateConfig.mockResolvedValue({ success: true });
  });

  it('loads and normalises the config, clean on arrival', async () => {
    const { result } = await loadHook();
    expect(result.current.getValue('timezone')).toBe('Europe/Dublin');
    // Stored as a string by older rows; the form works in numbers.
    expect(result.current.getValue('starting_balance')).toBe(5);
    expect(result.current.dirty).toBe(false);
    expect(result.current.loadError).toBe(false);
  });

  it('reports a load failure without throwing', async () => {
    mockAdminEnterprise.getConfig.mockResolvedValue({ success: false, error: 'Server error' });
    const { result } = await loadHook();
    expect(result.current.loadError).toBe(true);
    const outcome = await result.current.save();
    expect(outcome.ok).toBe(false);
    expect(mockAdminEnterprise.updateConfig).not.toHaveBeenCalled();
  });

  it('does not PUT when nothing changed', async () => {
    const { result } = await loadHook();
    let outcome: Awaited<ReturnType<typeof result.current.save>> | undefined;
    await act(async () => {
      outcome = await result.current.save();
    });
    expect(outcome).toEqual({ ok: true, changed: false });
    expect(mockAdminEnterprise.updateConfig).not.toHaveBeenCalled();
  });

  it('PUTs only the changed fields and reloads afterwards', async () => {
    const { result } = await loadHook();
    act(() => result.current.setValue('starting_balance', 3));
    expect(result.current.dirty).toBe(true);
    expect(Array.from(result.current.dirtyKeys)).toEqual(['starting_balance']);

    await act(async () => {
      await result.current.save();
    });
    expect(mockAdminEnterprise.updateConfig).toHaveBeenCalledWith({ starting_balance: 3 });
    expect(mockAdminEnterprise.getConfig).toHaveBeenCalledTimes(2);
  });

  // The endpoint accepts many more keys than this page offers: the sign-up
  // gates only a platform super-admin may change (F-054), maintenance mode,
  // and the settings that came off the page on 13 Nov 2026. None of them can
  // be written from here, whoever is signed in and whatever a caller sets.
  it('never sends a key the page does not own', async () => {
    mockAuthState.user = { id: 1, role: 'super_admin', is_super_admin: true } as User;
    const { result } = await loadHook();
    act(() => {
      result.current.setValue('require_email_verification', false);
      result.current.setValue('require_approval', true);
      result.current.setValue('maintenance_mode', true);
      result.current.setValue('site_name', 'Renamed');
      result.current.setValue('locale', 'de');
      result.current.setValue('auto_approve_listings', false);
      result.current.setValue('max_listings_per_user', 3);
      result.current.setValue('onboarding_enabled', false);
      result.current.setValue('timezone', 'Europe/London');
    });
    expect(result.current.buildPayload()).toEqual({ timezone: 'Europe/London' });
  });

  it('validates numbers against the schema and blocks save on error', async () => {
    const { result } = await loadHook();
    act(() => result.current.setValue('max_transaction', 5000));
    expect(result.current.errors.max_transaction).toBeTruthy();
    expect(Object.keys(result.current.validateAll())).toContain('max_transaction');

    act(() => result.current.setValue('max_transaction', 40));
    expect(result.current.errors.max_transaction).toBeUndefined();
    expect(result.current.validateAll()).toEqual({});
  });

  it('discard puts the loaded values back', async () => {
    const { result } = await loadHook();
    act(() => result.current.setValue('timezone', 'Asia/Tokyo'));
    act(() => result.current.discard());
    expect(result.current.dirty).toBe(false);
    expect(result.current.getValue('timezone')).toBe('Europe/Dublin');
  });
});

// Owner decisions. 26 Oct 2026: nothing enforces the profanity filter, so the
// switch is not offered. 13 Nov 2026: the same for nine more settings nothing
// reads, and three that another admin page owns. A stored value is left alone
// (never sent).
describe('system config schema', () => {
  it('offers only the three settings this page owns', async () => {
    const { buildConfigSettings, SCHEMA_KEYS } = await import('./systemConfigSchema');
    const keys = buildConfigSettings((key) => key).map((s) => s.key);

    expect(keys).toEqual(['timezone', 'starting_balance', 'max_transaction']);
    expect(Array.from(SCHEMA_KEYS)).toEqual(keys);
  });

  it.each([
    'profanity_filter',
    'locale', 'currency_name', 'currency_symbol', 'auto_approve_listings', 'auto_approve_blog',
    'email_notifications_enabled', 'push_notifications_enabled', 'digest_frequency',
    'max_groups_per_user', 'max_file_upload_mb',
    'onboarding_enabled', 'max_listings_per_user', 'max_listing_images',
  ])('does not offer %s', async (key) => {
    const { SCHEMA_KEYS } = await import('./systemConfigSchema');
    expect(SCHEMA_KEYS.has(key)).toBe(false);
  });
});
