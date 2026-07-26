// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for useLegalDocument hook
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLegalDocument } from './useLegalDocument';

// Mock dependencies
const mockApiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}));

let mockTenantLoading = false;
let mockTenant: { id: number; slug: string } | null = { id: 2, slug: 'hour-timebank' };

// useLegalDocument imports useTenant by its DIRECT path
// (`@/contexts/TenantContext`), so the mock must live on that specifier — a
// '@/contexts' barrel mock is never consulted and the real provider-backed hook
// throws, because renderHook mounts the hook with no TenantProvider. Partial
// mock so TenantProvider and the other exports stay real.
vi.mock('@/contexts/TenantContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/TenantContext')>()),
  useTenant: () => ({
    isLoading: mockTenantLoading,
    tenant: mockTenant,
  }),
}));

describe('useLegalDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTenantLoading = false;
    mockTenant = { id: 2, slug: 'hour-timebank' };
  });

  it('fetches legal document when tenant is ready', async () => {
    const mockDoc = {
      id: 1,
      document_id: 10,
      type: 'terms',
      title: 'Terms of Service',
      content: '<h2>Terms</h2><p>Content here</p>',
      version_number: '1.0',
      effective_date: '2026-01-01',
      summary_of_changes: null,
      has_previous_versions: false,
    };

    mockApiGet.mockResolvedValue({
      success: true,
      data: mockDoc,
    });

    const { result } = renderHook(() => useLegalDocument('terms'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.document).toEqual(mockDoc);
    expect(mockApiGet).toHaveBeenCalledWith('/v2/legal/terms', { skipAuth: true });
  });

  it('returns null document when API returns no data', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: null,
    });

    const { result } = renderHook(() => useLegalDocument('privacy'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.document).toBeNull();
  });

  it('waits for tenant context before fetching', async () => {
    mockTenantLoading = true;

    const { result } = renderHook(() => useLegalDocument('terms'));

    // Should still be loading while tenant is loading
    expect(result.current.loading).toBe(true);
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('skips fetch when tenant is null (failed to load)', async () => {
    mockTenant = null;

    const { result } = renderHook(() => useLegalDocument('terms'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.document).toBeNull();
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('handles API error gracefully', async () => {
    mockApiGet.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useLegalDocument('cookies'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.document).toBeNull();
  });

  it('rejects response without id/content shape', async () => {
    // API returns a wrapper object instead of the actual document
    mockApiGet.mockResolvedValue({
      success: true,
      data: { success: true, some_other: 'data' },
    });

    const { result } = renderHook(() => useLegalDocument('terms'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.document).toBeNull();
  });

  it('accepts valid document with id and content', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: {
        id: 5,
        content: '<p>Privacy policy</p>',
        type: 'privacy',
        title: 'Privacy',
        version_number: '2.0',
        effective_date: '2026-02-01',
      },
    });

    const { result } = renderHook(() => useLegalDocument('privacy'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.document).not.toBeNull();
    expect(result.current.document!.id).toBe(5);
  });
});
