// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@sentry/react-native', () => ({ addBreadcrumb: jest.fn(), captureException: jest.fn() }));

const mockGetCategories = jest.fn();
let mockTenant: { id: number; slug: string; branding: { primary_color?: string } } | null = null;

const mockGetEventCategories = jest.fn();
const mockGetBlogCategories = jest.fn();
const mockGetCourseCategories = jest.fn();
const mockGetMarketplaceCategories = jest.fn();

jest.mock('@/lib/api/exchanges', () => ({ getExchangeCategories: () => mockGetCategories() }));
jest.mock('@/lib/api/events', () => ({ getEventCategories: () => mockGetEventCategories() }));
jest.mock('@/lib/api/blog', () => ({ getBlogCategories: () => mockGetBlogCategories() }));
jest.mock('@/lib/api/courses', () => ({ getCourseCategories: () => mockGetCourseCategories() }));
jest.mock('@/lib/api/marketplace', () => ({ getMarketplaceCategories: () => mockGetMarketplaceCategories() }));
jest.mock('@/lib/context/TenantContext', () => ({
  useOptionalTenantContext: () => (mockTenant ? { tenant: mockTenant } : null),
}));

import { categoryListColours, colourForSeed, paletteFor, themeColourNames } from './itemColours';
import { forgetListingThemes, listingColour, useCategoryListColours, useItemPalette, useListingThemeColours } from './useItemColours';

beforeEach(() => {
  for (const mock of [mockGetCategories, mockGetEventCategories, mockGetBlogCategories, mockGetCourseCategories, mockGetMarketplaceCategories]) mock.mockReset();
  mockTenant = null;
  forgetListingThemes();
});

/**
 * Warmth plan W3 (website, 10 Nov 2026): a list's categories share the palette out in id
 * order, so no two categories of the events (or blog, courses, marketplace) list share a
 * colour by chance. The app reads the same lists and colours them the same way.
 */
describe('useCategoryListColours', () => {
  const eventCategories = [{ id: 9, name: 'Walks', color: 'blue' }, { id: 2, name: 'Social', color: 'blue' }, { id: 5, name: 'Learning', color: 'blue' }];

  it('colours each event category as the website does, reading the list once per community', async () => {
    mockTenant = { id: 2, slug: 'hour-timebank', branding: { primary_color: '#0d9488' } };
    mockGetEventCategories.mockResolvedValue({ data: eventCategories });
    const expected = categoryListColours(eventCategories, '#0d9488');

    const first = renderHook(() => useCategoryListColours('event'));
    await waitFor(() => expect(first.result.current(2)).toBe(expected.get('2')));
    expect(first.result.current(9)).toBe(expected.get('9'));
    expect(new Set([2, 5, 9].map((id) => first.result.current(id))).size).toBe(3);
    const second = renderHook(() => useCategoryListColours('event'));
    await waitFor(() => expect(second.result.current(5)).toBe(expected.get('5')));

    expect(mockGetEventCategories).toHaveBeenCalledTimes(1);
  });

  it('answers nothing for a category not in the list, for no category, and before the list loads — the item keeps its own colour', async () => {
    mockTenant = { id: 2, slug: 'hour-timebank', branding: {} };
    let release: (value: unknown) => void = () => {};
    mockGetBlogCategories.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    const { result } = renderHook(() => useCategoryListColours('blog'));
    expect(result.current(2)).toBeUndefined();
    release({ data: [{ id: 2, name: 'News', color: 'blue' }] });
    await waitFor(() => expect(result.current(2)).toBeDefined());
    expect(result.current(404)).toBeUndefined();
    expect(result.current(null)).toBeUndefined();
  });

  it('keeps every item on its own colour when a list cannot load, and asks again next time', async () => {
    mockTenant = { id: 2, slug: 'hour-timebank', branding: {} };
    mockGetCourseCategories.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([{ id: 1, name: 'Craft', slug: 'craft' }]);

    const failed = renderHook(() => useCategoryListColours('course'));
    await waitFor(() => expect(mockGetCourseCategories).toHaveBeenCalledTimes(1));
    expect(failed.result.current(1)).toBeUndefined();

    const again = renderHook(() => useCategoryListColours('course'));
    await waitFor(() => expect(again.result.current(1)).toBeDefined());
    expect(mockGetCourseCategories).toHaveBeenCalledTimes(2);
  });

  it('asks nothing without a community', () => {
    const { result } = renderHook(() => useCategoryListColours('marketplace'));
    expect(result.current(1)).toBeUndefined();
    expect(mockGetMarketplaceCategories).not.toHaveBeenCalled();
  });
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
