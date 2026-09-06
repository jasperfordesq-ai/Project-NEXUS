// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
let mockSearchParams: Record<string, string | string[] | undefined> = {};

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: mockPush, replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'common:buttons.retry': 'Retry',
        'common:errors.alertTitle': 'Something went wrong',
        'map.eyebrow': 'Nearby discovery',
        'map.title': 'Nearby marketplace',
        'map.subtitle': 'Browse listings near a shared, saved, or manually entered location.',
        'map.latitude': 'Latitude',
        'map.latitudePlaceholder': '40.7128',
        'map.longitude': 'Longitude',
        'map.longitudePlaceholder': '-74.0060',
        'map.radius': 'Radius',
        'map.search': 'Search nearby',
        'map.useCurrentLocation': 'Use current location',
        'map.place': 'Place',
        'map.placePlaceholder': 'Town, city, or postcode',
        'map.searchPlace': 'Search this place',
        'map.placeNotFound': 'We could not find that place. Try a nearby town or a postcode.',
        'map.placeLookupFailed': 'We could not look up that place on this device. Enter coordinates instead.',
        'map.invalidCoordinates': 'Enter a valid latitude and longitude.',
        'map.loadFailed': 'Could not load nearby marketplace listings.',
        'map.startTitle': 'Enter a location',
        'map.startSubtitle': 'Enter coordinates or open a shared map link to browse nearby marketplace listings.',
        'map.emptyTitle': 'No nearby listings found',
        'map.emptySubtitle': 'Try a wider radius or another location.',
        'featureGate.title': 'Marketplace unavailable',
        'featureGate.description': 'Marketplace is not enabled for this community.',
      };
      if (key === 'map.radiusOption') return `${String(opts?.radius ?? '')} km`;
      if (key === 'map.results') return `${String(opts?.count ?? 0)} nearby listings`;
      if (key === 'map.radiusLabel') return `Within ${String(opts?.radius ?? '')} km`;
      if (key === 'map.coordinatesLabel') return `${String(opts?.latitude ?? '')}, ${String(opts?.longitude ?? '')}`;
      if (key === 'map.distance') return `${String(opts?.distance ?? '')} km away`;
      if (key === 'map.nearestResult') return `Closest result: ${String(opts?.distance ?? '')} km away`;
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback dependency
  // array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/marketplace/MarketplaceListingCard', () => ({ item }: { item: { title: string } }) => item.title);

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#2563eb',
  useTenant: () => ({ hasFeature: () => true }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    border: '#d1d5db',
    success: '#16a34a',
    warning: '#f59e0b',
    error: '#dc2626',
  }),
}));

jest.mock('@/lib/api/marketplace', () => ({
  getNearbyMarketplaceListings: jest.fn(),
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  // The phone's own geocoder, behind the place-name search (audit F14).
  geocodeAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

import MarketplaceMapRoute from './marketplace-map';
import { getNearbyMarketplaceListings } from '@/lib/api/marketplace';
import * as Location from 'expo-location';

describe('MarketplaceMapRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = {};
    (getNearbyMarketplaceListings as jest.Mock).mockResolvedValue({ data: [] });
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ status: 'granted' } as never);
    jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue({
      coords: { latitude: 53.3498, longitude: -6.2603 },
    } as never);
  });

  it('honors React marketplace map lat/lng deep links', async () => {
    mockSearchParams = { lat: '52.52', lng: '13.405', radius: '50' };

    const { getByText, unmount } = render(<MarketplaceMapRoute />);

    fireEvent.press(getByText('Search nearby'));

    await waitFor(() => {
      expect(getNearbyMarketplaceListings).toHaveBeenCalledWith({
        latitude: 52.52,
        longitude: 13.405,
        radius: 50,
        limit: 50,
      });
    });

    unmount();
  });

  /*
    🔴 Audit F14. The panel above the search fields drew a fixed grid and three coloured
    dots at hardcoded positions and captioned them "{{count}} pins". It received no listing
    coordinates and never could: changing the location or the results changed the number and
    left the dots exactly where they were, so a member was shown three geographical markers
    that corresponded to nothing and told those were their results. The nearby search itself
    is real; only the picture of it was invented.
  */
  /*
    🔴 Audit F14, second half: "provide place search / manual-location entry that does
    not require members to know latitude and longitude."

    Before this the only ways in were "use my current location" and typing a latitude and a
    longitude by hand. Almost nobody knows the coordinates of their own town, so a member
    who wanted to browse listings anywhere other than where they were standing had no way to
    say where. `Location.geocodeAsync` is the phone's own geocoder, already available
    through `expo-location` — no new native module, so this reaches existing installs.
  */
  it('searches by place name and shows what the name resolved to', async () => {
    jest.mocked(Location.geocodeAsync).mockResolvedValue(
      [{ latitude: 53.2707, longitude: -9.0568 }] as never,
    );

    const { getByTestId, getByDisplayValue, unmount } = render(<MarketplaceMapRoute />);
    fireEvent.changeText(getByTestId('marketplace-map-place'), 'Galway');
    fireEvent.press(getByTestId('marketplace-map-place-search'));

    await waitFor(() => expect(getNearbyMarketplaceListings).toHaveBeenCalledWith({
      latitude: 53.2707,
      longitude: -9.0568,
      radius: 25,
      limit: 50,
    }));
    // Written back into the fields rather than hidden, so the member can see, correct or
    // share what the name resolved to.
    expect(getByDisplayValue('53.2707')).toBeTruthy();
    expect(getByDisplayValue('-9.0568')).toBeTruthy();

    unmount();
  });

  it('says a place could not be found instead of searching from nowhere', async () => {
    jest.mocked(Location.geocodeAsync).mockResolvedValue([] as never);

    const { getByTestId, getByText, unmount } = render(<MarketplaceMapRoute />);
    fireEvent.changeText(getByTestId('marketplace-map-place'), 'Nowhere at all');
    fireEvent.press(getByTestId('marketplace-map-place-search'));

    await waitFor(() => expect(getByText(/could not find that place/)).toBeTruthy());
    expect(getNearbyMarketplaceListings).not.toHaveBeenCalled();

    unmount();
  });

  it('points at the coordinate fields when the device has no geocoder', async () => {
    // A device with no Google Play services, or one that is offline, has no geocoder at
    // all. Saying what to do instead beats a bare failure.
    jest.mocked(Location.geocodeAsync).mockRejectedValue(new Error('no geocoder'));

    const { getByTestId, getByText, unmount } = render(<MarketplaceMapRoute />);
    fireEvent.changeText(getByTestId('marketplace-map-place'), 'Galway');
    fireEvent.press(getByTestId('marketplace-map-place-search'));

    await waitFor(() => expect(getByText(/Enter coordinates instead/)).toBeTruthy());

    unmount();
  });

  it('summarises the search area from real results instead of drawing invented pins', async () => {
    mockSearchParams = { latitude: '53.3498', longitude: '-6.2603', radius: '25' };
    (getNearbyMarketplaceListings as jest.Mock).mockResolvedValue({
      data: [
        { id: 1, title: 'Ladder', distance_km: 4.2 },
        { id: 2, title: 'Drill', distance_km: 1.8 },
      ],
    });

    const { getByTestId, getByText, queryByText, unmount } = render(<MarketplaceMapRoute />);
    fireEvent.press(getByText('Search nearby'));

    // Counts LISTINGS, which is what the search returns.
    await waitFor(() => expect(getByTestId('marketplace-map-preview')).toHaveTextContent(/2 nearby listings/));
    // The nearest distance comes from the results, not from a fixed position on a drawing.
    expect(getByTestId('marketplace-map-nearest')).toHaveTextContent(/1\.8/);
    // And nothing on screen promises pins any more.
    expect(queryByText(/pin/i)).toBeNull();

    unmount();
  });

  it('uses shared radius presets for nearby searches', async () => {
    mockSearchParams = { latitude: '40.7128', longitude: '-74.0060', radius: '25' };

    const { getByText, unmount } = render(<MarketplaceMapRoute />);

    fireEvent.press(getByText('100 km'));
    fireEvent.press(getByText('Search nearby'));

    await waitFor(() => {
      expect(getNearbyMarketplaceListings).toHaveBeenCalledWith(
        expect.objectContaining({ radius: 100 }),
      );
    });

    unmount();
  });

  it('sends coordinates entered through shared input fields', async () => {
    const { getByPlaceholderText, getByText, unmount } = render(<MarketplaceMapRoute />);

    fireEvent.changeText(getByPlaceholderText('40.7128'), '51.5074');
    fireEvent.changeText(getByPlaceholderText('-74.0060'), '-0.1278');
    fireEvent.press(getByText('Search nearby'));

    await waitFor(() => {
      expect(getNearbyMarketplaceListings).toHaveBeenCalledWith(
        expect.objectContaining({
          latitude: 51.5074,
          longitude: -0.1278,
        }),
      );
    });

    unmount();
  });

  it('can search from the device current location', async () => {
    const { getByText, unmount } = render(<MarketplaceMapRoute />);

    fireEvent.press(getByText('Use current location'));

    await waitFor(() => {
      expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled();
      expect(getNearbyMarketplaceListings).toHaveBeenCalledWith({
        latitude: 53.3498,
        longitude: -6.2603,
        radius: 25,
        limit: 50,
      });
    });

    unmount();
  });
});
