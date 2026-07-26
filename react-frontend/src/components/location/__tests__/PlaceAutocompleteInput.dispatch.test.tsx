// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests that PlaceAutocompleteInput dispatches to the correct backend
 * (Google Places vs Nominatim) based on the tenant's `geocodingProvider`
 * setting. The Google branch should NOT mount when tenant is on Nominatim.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: { fallbackValue?: string }) => o?.fallbackValue ?? k,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const mockUseTenant = vi.fn(() => ({
  hasFeature: () => true,
  mapProvider: 'google' as const,
  geocodingProvider: 'google' as const,
}));

// 🔴 Mock TenantContext by its DIRECT path, not the '@/contexts' barrel.
// PlaceAutocompleteInput.tsx:20 imports `useTenant` from
// '@/contexts/TenantContext'. Vitest's mock registry is keyed per-specifier, so
// a `vi.mock('@/contexts')` override never applies here — the real hook loads
// and throws "useTenant must be used within a TenantProvider"
// (TenantContext.tsx:722).
// Partial mock so sibling exports (TenantProvider, useTenantLanguages, …) stay real.
vi.mock('@/contexts/TenantContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/TenantContext')>();
  return { ...actual, useTenant: () => mockUseTenant() };
});

const fetchSpy = vi.fn(async () =>
  new Response(JSON.stringify({ data: { enabled: false, apiKey: '', mapId: null } }), {
    status: 200,
  })
);

vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="google-api-provider">{children}</div>
  ),
  useMapsLibrary: () => null,
}));

import { PlaceAutocompleteInput } from '../PlaceAutocompleteInput';
import { resetGoogleMapsConfigForTests } from '../GoogleMapsProvider';

function W({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemoryRouter>{children}</MemoryRouter>
    </>
  );
}

describe('PlaceAutocompleteInput — provider dispatch', () => {
  it('defers the Google branch until focus when geocodingProvider=google', async () => {
    resetGoogleMapsConfigForTests();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
    mockUseTenant.mockReturnValueOnce({
      hasFeature: () => true,
      mapProvider: 'google' as const,
      geocodingProvider: 'google' as const,
    });

    const { container } = render(
      <W>
        <PlaceAutocompleteInput value="" onChange={() => {}} />
      </W>
    );

    expect(container.querySelector('input')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.focus(container.querySelector('input')!);

    // The Google branch fetches /v2/config/google-maps after activation. With
    // config disabled, it falls back to PlaceAutocompleteFallback (plain Input).
    // The Nominatim branch never queries that endpoint.
    await waitFor(() => {
      const calls = fetchSpy.mock.calls.map((c) => String(c[0]));
      expect(calls.some((u) => u.includes('/v2/config/google-maps'))).toBe(true);
    });
  });

  it('does NOT mount the Google branch when geocodingProvider=nominatim', async () => {
    fetchSpy.mockClear();
    mockUseTenant.mockReturnValueOnce({
      hasFeature: () => true,
      mapProvider: 'openstreetmap' as const,
      geocodingProvider: 'nominatim' as const,
    });

    render(
      <W>
        <PlaceAutocompleteInput value="" onChange={() => {}} />
      </W>
    );

    // Critical: with Nominatim selected, the Google config endpoint must NEVER
    // be hit. This is the "no Google traffic" guarantee.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'a' } });
    await new Promise((r) => setTimeout(r, 200));

    const calls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes('/v2/config/google-maps'))).toBe(false);
  });
});
