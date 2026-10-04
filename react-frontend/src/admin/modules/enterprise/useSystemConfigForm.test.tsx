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
  welcome_message: '',
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

async function loadHook(opts?: { excludeKeys?: string[] }) {
  const { useSystemConfigForm } = await import('./useSystemConfigForm');
  const hook = renderHook(() => useSystemConfigForm(opts));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe('useSystemConfigForm', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuthState.user = null;
    mockAdminEnterprise.getConfig.mockResolvedValue({ success: true, data: makeConfig() });
    mockAdminEnterprise.updateConfig.mockResolvedValue({ success: true });
    mockAdminEnterprise.resetConfig.mockResolvedValue({ success: true });
  });

  it('loads and normalises the config, clean on arrival', async () => {
    const { result } = await loadHook();
    expect(result.current.getValue('site_name')).toBe('My Timebank');
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
    act(() => result.current.setValue('site_name', 'Updated Timebank'));
    expect(result.current.dirty).toBe(true);
    expect(Array.from(result.current.dirtyKeys)).toEqual(['site_name']);

    await act(async () => {
      await result.current.save();
    });
    expect(mockAdminEnterprise.updateConfig).toHaveBeenCalledWith({ site_name: 'Updated Timebank' });
    expect(mockAdminEnterprise.getConfig).toHaveBeenCalledTimes(2);
  });

  it('excludes parent-owned keys from the schema, dirty set and payload', async () => {
    const { result } = await loadHook({ excludeKeys: ['site_name'] });
    expect(result.current.schema.flatMap((g) => g.settings).some((s) => s.key === 'site_name')).toBe(false);
    act(() => result.current.setValue('site_name', 'Ignored'));
    expect(result.current.dirty).toBe(false);
    expect(result.current.buildPayload()).toEqual({});
  });

  it('never sends maintenance_mode or reserved keys for a plain admin (F-054)', async () => {
    mockAuthState.user = { id: 5, role: 'admin', is_admin: true } as User;
    const { result } = await loadHook();
    expect(result.current.isTierLocked('require_email_verification')).toBe(true);
    expect(result.current.isReadOnly('maintenance_mode')).toBe(true);
    act(() => {
      result.current.setValue('require_email_verification', false);
      result.current.setValue('maintenance_mode', true);
      result.current.setValue('site_name', 'Renamed');
    });
    expect(result.current.buildPayload()).toEqual({ site_name: 'Renamed' });
  });

  it('lets a platform super-admin change email verification', async () => {
    mockAuthState.user = { id: 1, role: 'super_admin', is_super_admin: true } as User;
    const { result } = await loadHook();
    expect(result.current.isTierLocked('require_email_verification')).toBe(false);
    act(() => result.current.setValue('require_email_verification', false));
    expect(result.current.buildPayload()).toEqual({ require_email_verification: false });
  });

  it('validates numbers against the schema and blocks save on error', async () => {
    const { result } = await loadHook();
    const def = result.current.schema.flatMap((g) => g.settings).find((s) => s.key === 'max_listing_images')!;
    act(() => result.current.setValue('max_listing_images', 99, def));
    expect(result.current.errors.max_listing_images).toBeTruthy();
    expect(Object.keys(result.current.validateAll())).toContain('max_listing_images');
  });

  it('discard puts the loaded values back', async () => {
    const { result } = await loadHook();
    act(() => result.current.setValue('site_name', 'Draft'));
    act(() => result.current.discard());
    expect(result.current.dirty).toBe(false);
    expect(result.current.getValue('site_name')).toBe('My Timebank');
  });

  it('reset calls the API and reloads', async () => {
    const { result } = await loadHook();
    await act(async () => {
      const res = await result.current.reset();
      expect(res.ok).toBe(true);
    });
    expect(mockAdminEnterprise.resetConfig).toHaveBeenCalledTimes(1);
    expect(mockAdminEnterprise.getConfig).toHaveBeenCalledTimes(2);
  });
});
