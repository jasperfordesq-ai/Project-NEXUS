// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@sentry/react-native', () => ({ addBreadcrumb: jest.fn(), captureException: jest.fn() }));

const mockGetCategories = jest.fn();
let mockTenant: { id: number; slug: string; branding: { primary_color?: string } } | null = null;

jest.mock('@/lib/api/exchanges', () => ({ getExchangeCategories: () => mockGetCategories() }));
jest.mock('@/lib/context/TenantContext', () => ({
  useOptionalTenantContext: () => (mockTenant ? { tenant: mockTenant } : null),
}));

import { colourForSeed, paletteFor, themeColourNames } from './itemColours';
import { forgetListingThemes, listingColour, useItemPalette, useListingThemeColours } from './useItemColours';

beforeEach(() => {
  mockGetCategories.mockReset();
  mockTenant = null;
  forgetListingThemes();
});

describe('useItemPalette', () => {
  it('follows the community\'s own colour, as the website does', () => {
    mockTenant = { id: 2, slug: 'hour-timebank', branding: { primary_color: '#0d9488' } };
    const { result } = renderHook(() => useItemPalette());
    expect(result.current).toEqual(paletteFor('#0d9488'));
  });

  /**
   * 🔴 Not the app's own blue fallback (#006FEE): the website falls back to its standard
   * colour, whose palette is different, so a community with no colour chosen would get
   * different item colours on the phone.
   */
  it('uses the website\'s standard palette when the community has not chosen a colour', () => {
    mockTenant = { id: 2, slug: 'hour-timebank', branding: {} };
    const { result } = renderHook(() => useItemPalette());
    expect(result.current).toEqual(paletteFor(null));
    expect(result.current).not.toEqual(paletteFor('#006FEE'));
  });
});

describe('listingColour', () => {
  const palette = paletteFor(null);

  it('uses the offer\'s theme colour first, then the stored colour, then one chosen by its id', () => {
    expect(listingColour({ id: 5, category_slug: 'garden', category_color: 'blue' }, { garden: 'teal' }, palette)).toBe('teal');
    expect(listingColour({ id: 5, category_slug: 'unknown', category_color: 'rose' }, { garden: 'teal' }, palette)).toBe('rose');
    expect(listingColour({ id: 5, category_slug: null, category_color: null }, {}, palette)).toBe(colourForSeed(5, palette));
  });
});

describe('useListingThemeColours', () => {
  it('colours the community\'s themes exactly as the website\'s offers page, asking once', async () => {
    mockTenant = { id: 2, slug: 'hour-timebank', branding: { primary_color: '#e11d48' } };
    const themes = [{ slug: 'garden', color: 'blue' }, { slug: 'care', color: 'blue' }, { slug: 'lifts', color: 'blue' }];
    mockGetCategories.mockResolvedValue({ data: themes });

    const first = renderHook(() => useListingThemeColours());
    await waitFor(() => expect(first.result.current).toEqual(themeColourNames(themes, '#e11d48')));
    const second = renderHook(() => useListingThemeColours());
    await waitFor(() => expect(second.result.current).toEqual(themeColourNames(themes, '#e11d48')));

    expect(mockGetCategories).toHaveBeenCalledTimes(1);
  });

  it('asks nothing without a community, and gives no theme colours when the list cannot load', async () => {
    const none = renderHook(() => useListingThemeColours());
    expect(none.result.current).toEqual({});
    expect(mockGetCategories).not.toHaveBeenCalled();

    mockTenant = { id: 3, slug: 'other', branding: {} };
    mockGetCategories.mockRejectedValue(new Error('offline'));
    const failed = renderHook(() => useListingThemeColours());
    await waitFor(() => expect(mockGetCategories).toHaveBeenCalledTimes(1));
    expect(failed.result.current).toEqual({});
  });
});
