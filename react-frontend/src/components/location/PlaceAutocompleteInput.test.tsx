// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for PlaceAutocompleteInput
 *
 * PlaceAutocompleteInput dispatches on geocodingProvider from useTenant():
 *   - 'nominatim'  → renders <NominatimAutocomplete>
 *   - 'os_places'  → renders <OsPlacesAutocomplete>
 *   - 'google'     → renders <GoogleMapsProvider> wrapping <PlaceAutocompleteWithGoogle>
 *
 * Strategy: use a single mutable `providerRef` so all tests share one hoisted
 * '@/contexts/TenantContext' mock — tests set providerRef.value before rendering.
 *
 * The 'google' branch renders DeferredGooglePlaceAutocomplete, which shows the
 * real PlaceAutocompleteFallback (HeroUI Input + clear Button) until focus/edit
 * activates the lazy Google module. GoogleMapsProvider is stubbed to render its
 * `fallback` prop so that activation path never hits an external API.
 * NominatimAutocomplete and OsPlacesAutocomplete are mocked as simple stubs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

// ── Hoist the mutable geocoding-provider ref ─────────────────────────────────
const { providerRef } = vi.hoisted(() => ({
  providerRef: { value: 'google' as string },
}));

// ── TenantContext mock on its DIRECT path, read at call time ──────────────────
// 🔴 PlaceAutocompleteInput.tsx:20 imports `useTenant` from
// '@/contexts/TenantContext'. Vitest keys its mock registry per-specifier, so the
// old `vi.mock('@/contexts', ...)` override never applied — the real hook loaded
// and threw "useTenant must be used within a TenantProvider"
// (TenantContext.tsx:722), killing every test in this file. Total factory
// (rather than spreading importOriginal) on purpose: the real module imports
// '@/i18n', which re-inits i18next with an HTTP backend at module scope and
// would clobber the English resources src/test/setup.ts loads synchronously.
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: { id: 2, name: 'Test', slug: 'test' },
    tenantSlug: 'test',
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: () => true,
    hasModule: () => true,
    mapProvider: 'google',
    geocodingProvider: providerRef.value,
  }),
}));

// ── Mock child providers ──────────────────────────────────────────────────────
// Stub NominatimAutocomplete — minimal combobox so dispatch tests pass
vi.mock('./NominatimAutocomplete', () => ({
  NominatimAutocomplete: ({ label, value, onChange }: {
    label?: string;
    value: string;
    onChange?: (v: string) => void;
  }) => (
    <div data-testid="nominatim-autocomplete">
      {label && <label htmlFor="nominatim-input">{label}</label>}
      <input
        id="nominatim-input"
        role="combobox"
        aria-expanded="false"
        aria-controls="mock-listbox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        readOnly={!onChange}
      />
    </div>
  ),
}));

// Stub OsPlacesAutocomplete
vi.mock('./OsPlacesAutocomplete', () => ({
  OsPlacesAutocomplete: ({ label, value, onChange }: {
    label?: string;
    value: string;
    onChange?: (v: string) => void;
  }) => (
    <div data-testid="os-places-autocomplete">
      {label && <label htmlFor="os-input">{label}</label>}
      <input
        id="os-input"
        role="combobox"
        aria-expanded="false"
        aria-controls="mock-listbox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        readOnly={!onChange}
      />
    </div>
  ),
}));

// Stub GoogleMapsProvider — renders the fallback prop so we exercise PlaceAutocompleteFallback
vi.mock('./GoogleMapsProvider', () => ({
  GoogleMapsProvider: ({ fallback }: { fallback: React.ReactNode; children: React.ReactNode }) => (
    <>{fallback}</>
  ),
}));

// useMapsLibrary returns null (no Maps SDK in tests)
vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useMapsLibrary: () => null,
}));

// Need React in scope for JSX in stub functions above
import React from 'react';
import { PlaceAutocompleteInput } from './PlaceAutocompleteInput';

// ── PROVIDER DISPATCH TESTS ───────────────────────────────────────────────────
describe('PlaceAutocompleteInput — provider dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders NominatimAutocomplete for nominatim provider', () => {
    providerRef.value = 'nominatim';
    render(<PlaceAutocompleteInput value="" onChange={vi.fn()} />);
    expect(screen.getByTestId('nominatim-autocomplete')).toBeInTheDocument();
  });

  it('renders OsPlacesAutocomplete for os_places provider', () => {
    providerRef.value = 'os_places';
    render(<PlaceAutocompleteInput value="" onChange={vi.fn()} />);
    expect(screen.getByTestId('os-places-autocomplete')).toBeInTheDocument();
  });

  it('renders a text input for google provider (via GoogleMapsProvider → fallback)', () => {
    providerRef.value = 'google';
    render(<PlaceAutocompleteInput value="" onChange={vi.fn()} />);
    // GoogleMapsProvider is stubbed to render fallback (PlaceAutocompleteFallback)
    // which renders a plain text input
    const input = screen.queryByRole('textbox') ?? screen.queryByRole('combobox');
    expect(input).toBeInTheDocument();
  });

  it('forwards label prop to NominatimAutocomplete', () => {
    providerRef.value = 'nominatim';
    render(<PlaceAutocompleteInput value="" onChange={vi.fn()} label="Delivery address" />);
    expect(screen.getByText('Delivery address')).toBeInTheDocument();
  });

  it('forwards label prop to OsPlacesAutocomplete', () => {
    providerRef.value = 'os_places';
    render(<PlaceAutocompleteInput value="" onChange={vi.fn()} label="Pickup location" />);
    expect(screen.getByText('Pickup location')).toBeInTheDocument();
  });
});

// ── FALLBACK PATH TESTS (google provider, no Maps API) ───────────────────────
describe('PlaceAutocompleteFallback (google provider, no Maps API)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    providerRef.value = 'google';
  });

  it('renders a text input', () => {
    render(<PlaceAutocompleteInput value="" onChange={vi.fn()} />);
    const input = screen.queryByRole('textbox') ?? screen.queryByRole('combobox');
    expect(input).toBeInTheDocument();
  });

  it('calls onChange when user types in the fallback input', () => {
    const handleChange = vi.fn();
    render(<PlaceAutocompleteInput value="" onChange={handleChange} />);

    const input = screen.queryByRole('textbox') ?? screen.queryByRole('combobox');
    expect(input).toBeInTheDocument();
    fireEvent.change(input!, { target: { value: 'Dublin' } });
    expect(handleChange).toHaveBeenCalledWith('Dublin');
  });

  it('shows a clear button when value is non-empty', () => {
    render(<PlaceAutocompleteInput value="Dublin City Centre" onChange={vi.fn()} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('does not show a clear button when value is empty', () => {
    render(<PlaceAutocompleteInput value="" onChange={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('calls onChange("") and onClear when clear button is pressed', async () => {
    const handleChange = vi.fn();
    const handleClear = vi.fn();
    render(
      <PlaceAutocompleteInput
        value="Dublin City Centre"
        onChange={handleChange}
        onClear={handleClear}
      />
    );

    const clearBtn = screen.getByRole('button');
    fireEvent.click(clearBtn);

    await waitFor(() => {
      expect(handleChange).toHaveBeenCalledWith('');
      expect(handleClear).toHaveBeenCalled();
    });
  });

  it('renders the label when provided', () => {
    render(<PlaceAutocompleteInput value="" onChange={vi.fn()} label="Your location" />);
    expect(screen.getByText('Your location')).toBeInTheDocument();
  });

  it('applies isRequired prop without crashing', () => {
    render(<PlaceAutocompleteInput value="" onChange={vi.fn()} label="Location" isRequired />);
    const input = screen.queryByRole('textbox') ?? screen.queryByRole('combobox');
    expect(input).toBeInTheDocument();
  });
});
