// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for useOnboardingConfig hook
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mockGet = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { useOnboardingConfig } from './useOnboardingConfig';

describe('useOnboardingConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns defaults while loading', () => {
    mockGet.mockReturnValue(new Promise(() => {})); // Never resolves

    const { result } = renderHook(() => useOnboardingConfig());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.config.enabled).toBe(true);
    expect(result.current.config.mandatory).toBe(true);
    expect(result.current.config.bio_min_length).toBe(10);
    // Retired 2026-10-02: no interests step, no auto-listing setting.
    expect(result.current.steps.map((s) => s.slug)).toEqual(['welcome', 'profile', 'skills', 'confirm']);
  });

  it('loads config from API', async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: {
        config: {
          enabled: false,
          mandatory: false,
          bio_min_length: 50,
          step_safeguarding_enabled: true,
        },
        steps: [
          { slug: 'welcome', label: 'Welcome', required: false },
          { slug: 'profile', label: 'Profile', required: true },
          { slug: 'safeguarding', label: 'Safeguarding', required: false },
          { slug: 'confirm', label: 'Confirm', required: true },
        ],
      },
    });

    const { result } = renderHook(() => useOnboardingConfig());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.config.enabled).toBe(false);
    expect(result.current.config.bio_min_length).toBe(50);
    expect(result.current.steps.length).toBe(4);
    expect(result.current.steps.map(s => s.slug)).toContain('safeguarding');
  });

  it('falls back to defaults on API error', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useOnboardingConfig());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should have defaults, not crash
    expect(result.current.config.enabled).toBe(true);
    expect(result.current.steps.length).toBe(4);
  });

  it('calls the correct API endpoint', async () => {
    mockGet.mockResolvedValue({ success: true, data: { config: {}, steps: [] } });

    renderHook(() => useOnboardingConfig());

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/v2/onboarding/config');
    });
  });

  it('default steps do not include safeguarding', () => {
    mockGet.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useOnboardingConfig());

    const slugs = result.current.steps.map(s => s.slug);
    expect(slugs).not.toContain('safeguarding');
    expect(slugs).toContain('welcome');
    expect(slugs).toContain('profile');
    expect(slugs).toContain('confirm');
  });
});
