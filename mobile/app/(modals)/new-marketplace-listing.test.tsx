// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';

let mockParams: Record<string, string> = {};
let mockTenantCurrency = 'EUR';

// Stable references so screens that put `show` in a useCallback/useEffect
// dependency array don't re-run their effects on every render.
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'forms.createTitle': 'Sell an item',
        'forms.editTitle': 'Edit listing',
        'forms.eyebrow': 'New marketplace listing',
        'forms.subtitle': 'Use complete details.',
        'forms.title': 'Title',
        'forms.titlePlaceholder': 'What are you selling?',
        'forms.tagline': 'Short tagline',
        'forms.taglinePlaceholder': 'A quick summary',
        'forms.description': 'Description',
        'forms.descriptionPlaceholder': 'Details',
        'forms.generateDescription': 'Generate with AI',
        'forms.generatingDescription': 'Generating description',
        'forms.generateTitleRequired': 'Add a title before generating a description.',
        'forms.generateDescriptionFailed': 'Could not generate a description.',
        'forms.validation': 'Validation',
        'forms.required': 'Title and description are required.',
        'forms.priceType': 'Price type',
        'forms.price': 'Price',
        'forms.currency': 'Currency',
        'forms.pricePlaceholder': '0.00',
        'forms.priceRequired': 'Enter a price greater than zero for paid listings.',
        'forms.timeCredits': 'Time credits',
        'forms.timeCreditsPlaceholder': 'Optional',
        'forms.condition': 'Condition',
        'forms.category': 'Category',
        'forms.quantity': 'Quantity',
        'forms.quantityPlaceholder': '1',
        'forms.location': 'Location',
        'forms.locationPlaceholder': 'Where can buyers collect it?',
        'forms.coordinates': 'Map coordinates',
        'forms.coordinatesHint': 'Optional coordinates help nearby search place this listing accurately.',
        'forms.latitude': 'Latitude',
        'forms.latitudePlaceholder': '51.5007',
        'forms.longitude': 'Longitude',
        'forms.longitudePlaceholder': '-0.1246',
        'forms.delivery': 'Delivery',
        'forms.sellerType': 'Seller type',
        'forms.media': 'Media',
        'forms.addImages': 'Add images',
        'forms.photosCount': 'Photos',
        'forms.imageAlt': 'Listing photo',
        'forms.coverImage': 'Cover',
        'forms.removeImage': 'Remove image',
        'forms.maxImagesReached': 'You can add up to 20 images.',
        'forms.video': 'Video',
        'forms.addVideo': 'Add video',
        'forms.changeVideo': 'Change video',
        'forms.videoHint': 'Add a video.',
        'forms.removeVideo': 'Remove video',
        'forms.videoSelected': 'Selected video',
        'forms.currentVideo': 'Current video',
        'forms.mediaHint': 'Add up to 20 images and one optional video.',
        'forms.footerCreateTitle': 'Review listing',
        'forms.footerEditTitle': 'Review changes',
        'forms.footerSubtitle': 'Publish when ready.',
        'forms.publish': 'Publish',
        'forms.update': 'Update',
        'filters.noCategory': 'No category',
        'inventory.section_title': 'Inventory',
        'inventory.section_subtitle': 'Track stock.',
        'inventory.unlimited': 'Unlimited stock',
        'inventory.oversold_protected': 'Reject overselling',
        'priceType.fixed': 'Fixed price',
        'priceType.negotiable': 'Negotiable',
        'priceType.free': 'Free',
        'priceType.contact': 'Contact seller',
        'condition.new': 'New',
        'condition.like_new': 'Like new',
        'condition.good': 'Good',
        'condition.fair': 'Fair',
        'condition.poor': 'Poor',
        'delivery_method.pickup': 'Local pickup',
        'delivery_method.shipping': 'Shipping',
        'delivery_method.both': 'Pickup or shipping',
        'delivery_method.community_delivery': 'Community delivery',
        'sellerType.private': 'Private seller',
        'sellerType.business': 'Business',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ tenant: { currency: mockTenantCurrency } }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    border: '#d1d5db',
    error: '#dc2626',
    success: '#16a34a',
  }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: { Images: 'Images', Videos: 'Videos' },
}));
jest.mock('@/lib/haptics', () => ({
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('@/components/ui/LoadingSpinner', () => () => null);

jest.mock('@/lib/api/marketplace', () => ({
  createMarketplaceListing: jest.fn(),
  generateMarketplaceDescription: jest.fn(),
  getMarketplaceCategories: jest.fn().mockResolvedValue({ data: [] }),
  getMarketplaceCategoryTemplate: jest.fn().mockResolvedValue({ data: { fields: [] } }),
  getMarketplaceListing: jest.fn(),
  updateMarketplaceListing: jest.fn(),
  deleteMarketplaceListingImage: jest.fn(),
  deleteMarketplaceVideo: jest.fn(),
  uploadMarketplaceImages: jest.fn(),
  uploadMarketplaceVideo: jest.fn(),
}));

import NewMarketplaceListingRoute from './new-marketplace-listing';
import { useAppToast } from '@/components/ui/AppToast';
import {
  createMarketplaceListing,
  deleteMarketplaceListingImage,
  generateMarketplaceDescription,
  getMarketplaceListing,
  updateMarketplaceListing,
  uploadMarketplaceImages,
  uploadMarketplaceVideo,
} from '@/lib/api/marketplace';

const mockShowToast = useAppToast().show as jest.Mock;

describe('NewMarketplaceListingRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    mockTenantCurrency = 'EUR';
  });

  it('renders optional coordinate fields for nearby search parity', async () => {
    const { getByText } = render(<NewMarketplaceListingRoute />);

    await waitFor(() => {
      expect(getByText('Map coordinates')).toBeTruthy();
      expect(getByText('Latitude')).toBeTruthy();
      expect(getByText('Longitude')).toBeTruthy();
    });
  });

  it('generates a marketplace description from the backend AI endpoint', async () => {
    jest.mocked(generateMarketplaceDescription).mockResolvedValue({
      data: { description: 'Generated mobile marketplace description.' },
    } as never);

    const { findByDisplayValue, getByPlaceholderText, getByText } = render(<NewMarketplaceListingRoute />);

    fireEvent.changeText(getByPlaceholderText('What are you selling?'), 'Garden shears');
    fireEvent.press(getByText('Generate with AI'));

    await waitFor(() => {
      expect(generateMarketplaceDescription).toHaveBeenCalledWith({
        title: 'Garden shears',
        category: undefined,
        condition: 'good',
      });
    });
    expect(await findByDisplayValue('Generated mobile marketplace description.')).toBeTruthy();
  });

  it('sends the selected marketplace currency when creating a listing', async () => {
    jest.mocked(createMarketplaceListing).mockResolvedValue({ data: { id: 88 } } as never);

    const { getByPlaceholderText, getByText } = render(<NewMarketplaceListingRoute />);

    fireEvent.changeText(getByPlaceholderText('What are you selling?'), 'Garden shears');
    fireEvent.changeText(getByPlaceholderText('Details'), 'Lightly used shears with clean blades.');
    fireEvent.changeText(getByPlaceholderText('0.00'), '12.50');
    fireEvent.press(getByText('USD'));
    fireEvent.press(getByText('Publish'));

    await waitFor(() => {
      expect(createMarketplaceListing).toHaveBeenCalledWith(expect.objectContaining({
        price: 12.5,
        price_currency: 'USD',
      }));
    });
  });

  /**
   * 🔴 Marketplace moderation is ON by default, so a published listing is not live yet.
   * The server says so in `meta.notice`; this screen used to throw it away and take the
   * seller to the listing with no hint that nobody else could see it.
   */
  it('tells the seller when the listing still needs a moderator', async () => {
    jest.mocked(createMarketplaceListing).mockResolvedValue({
      data: { id: 90 },
      meta: { notice: 'Your listing is waiting for a moderator.' },
    } as never);

    const { getByPlaceholderText, getByText } = render(<NewMarketplaceListingRoute />);

    fireEvent.changeText(getByPlaceholderText('What are you selling?'), 'Drying rack');
    fireEvent.changeText(getByPlaceholderText('Details'), 'Solid beech, folds flat for storage.');
    fireEvent.changeText(getByPlaceholderText('0.00'), '12');
    fireEvent.press(getByText('Publish'));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
        description: 'Your listing is waiting for a moderator.',
      }));
    });
  });

  it('stays quiet when the listing went live immediately', async () => {
    jest.mocked(createMarketplaceListing).mockResolvedValue({ data: { id: 91 }, meta: null } as never);

    const { getByPlaceholderText, getByText } = render(<NewMarketplaceListingRoute />);

    fireEvent.changeText(getByPlaceholderText('What are you selling?'), 'Drying rack');
    fireEvent.changeText(getByPlaceholderText('Details'), 'Solid beech, folds flat for storage.');
    fireEvent.changeText(getByPlaceholderText('0.00'), '12');
    fireEvent.press(getByText('Publish'));

    await waitFor(() => expect(createMarketplaceListing).toHaveBeenCalled());
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('uses the tenant payment currency for a new listing by default', async () => {
    mockTenantCurrency = 'JPY';
    jest.mocked(createMarketplaceListing).mockResolvedValue({ data: { id: 89 } } as never);

    const { getByPlaceholderText, getByText } = render(<NewMarketplaceListingRoute />);

    fireEvent.changeText(getByPlaceholderText('What are you selling?'), 'Vintage lamp');
    fireEvent.changeText(getByPlaceholderText('Details'), 'Working lamp in good condition.');
    fireEvent.changeText(getByPlaceholderText('0.00'), '2500');
    fireEvent.press(getByText('Publish'));

    await waitFor(() => {
      expect(createMarketplaceListing).toHaveBeenCalledWith(expect.objectContaining({
        price: 2500,
        price_currency: 'JPY',
      }));
    });
  });

  it('blocks paid listings without a positive price before calling the API', async () => {
    const { getByPlaceholderText, getByText } = render(<NewMarketplaceListingRoute />);

    fireEvent.changeText(getByPlaceholderText('What are you selling?'), 'Garden shears');
    fireEvent.changeText(getByPlaceholderText('Details'), 'Lightly used shears with clean blades.');
    fireEvent.press(getByText('Publish'));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Validation',
        description: 'Enter a price greater than zero for paid listings.',
        variant: 'warning',
      }));
    });
    expect(createMarketplaceListing).not.toHaveBeenCalled();
  });

  it('uploads a selected listing video after creating the listing', async () => {
    jest.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValue({ granted: true } as never);
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/demo.mp4', fileName: 'demo.mp4', mimeType: 'video/mp4', fileSize: 1024 }],
    } as never);
    jest.mocked(createMarketplaceListing).mockResolvedValue({ data: { id: 77 } } as never);
    jest.mocked(uploadMarketplaceVideo).mockResolvedValue({ data: { video_url: '/uploads/marketplace/demo.mp4' } } as never);

    const { getByPlaceholderText, getByText } = render(<NewMarketplaceListingRoute />);

    fireEvent.changeText(getByPlaceholderText('What are you selling?'), 'Garden shears');
    fireEvent.changeText(getByPlaceholderText('Details'), 'Lightly used shears with clean blades.');
    fireEvent.changeText(getByPlaceholderText('0.00'), '12.50');
    fireEvent.press(getByText('Add video'));

    await waitFor(() => {
      expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      }));
    });
    expect(getByText('demo.mp4')).toBeTruthy();

    fireEvent.press(getByText('Publish'));

    await waitFor(() => {
      expect(uploadMarketplaceVideo).toHaveBeenCalledWith(77, expect.objectContaining({
        uri: 'file:///tmp/demo.mp4',
        fileName: 'demo.mp4',
        mimeType: 'video/mp4',
      }));
    });
  });

  it('keeps existing edit photos visible and deletes removed server images', async () => {
    mockParams = { id: '42' };
    jest.mocked(getMarketplaceListing).mockResolvedValue({
      data: {
        id: 42,
        title: 'Garden shears',
        tagline: null,
        description: 'Lightly used shears with clean blades.',
        price: 12.5,
        price_currency: 'EUR',
        price_type: 'fixed',
        time_credit_price: null,
        condition: 'good',
        quantity: 1,
        location: null,
        delivery_method: 'pickup',
        seller_type: 'private',
        status: 'active',
        image: null,
        image_count: 1,
        images: [{ id: 5, url: 'https://example.test/shears.jpg', thumbnail_url: null }],
        video_url: null,
        category: null,
        user: null,
        is_saved: false,
        is_own: true,
        is_promoted: false,
        views_count: 0,
        saves_count: 0,
        created_at: '2026-05-01T00:00:00Z',
        latitude: null,
        longitude: null,
        shipping_available: false,
        local_pickup: true,
        template_data: null,
      },
    } as never);
    jest.mocked(updateMarketplaceListing).mockResolvedValue({ data: { id: 42 } } as never);

    const { getByDisplayValue, getByLabelText, getByText } = render(<NewMarketplaceListingRoute />);

    await waitFor(() => {
      expect(getByDisplayValue('Garden shears')).toBeTruthy();
      expect(getByText('Cover')).toBeTruthy();
    });

    fireEvent.press(getByLabelText('Remove image'));
    fireEvent.press(getByText('Update'));

    await waitFor(() => {
      expect(deleteMarketplaceListingImage).toHaveBeenCalledWith(42, 5);
    });
  });

  it('resolves relative existing image URLs in the edit preview', async () => {
    mockParams = { id: '44' };
    jest.mocked(getMarketplaceListing).mockResolvedValue({
      data: {
        id: 44,
        title: 'Garden shears',
        tagline: null,
        description: 'Lightly used shears with clean blades.',
        price: 12.5,
        price_currency: 'EUR',
        price_type: 'fixed',
        time_credit_price: null,
        condition: 'good',
        quantity: 1,
        location: null,
        delivery_method: 'pickup',
        seller_type: 'private',
        status: 'active',
        image: null,
        image_count: 1,
        images: [{ id: 8, url: '/uploads/marketplace/shears.jpg', thumbnail_url: null }],
        video_url: null,
        category: null,
        user: null,
        is_saved: false,
        is_own: true,
        is_promoted: false,
        views_count: 0,
        saves_count: 0,
        created_at: '2026-05-01T00:00:00Z',
        latitude: null,
        longitude: null,
        shipping_available: false,
        local_pickup: true,
        template_data: null,
      },
    } as never);

    const { getByLabelText } = render(<NewMarketplaceListingRoute />);

    await waitFor(() => {
      const image = getByLabelText('Listing photo');
      expect(image.props.source.uri).toBe('https://api.project-nexus.ie/uploads/marketplace/shears.jpg');
    });
  });

  it('adds new photos to an edited listing without dropping existing media', async () => {
    mockParams = { id: '43' };
    jest.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValue({ granted: true } as never);
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/new-photo.jpg' }],
    } as never);
    jest.mocked(getMarketplaceListing).mockResolvedValue({
      data: {
        id: 43,
        title: 'Garden shears',
        tagline: null,
        description: 'Lightly used shears with clean blades.',
        price: 12.5,
        price_currency: 'EUR',
        price_type: 'fixed',
        time_credit_price: null,
        condition: 'good',
        quantity: 1,
        location: null,
        delivery_method: 'pickup',
        seller_type: 'private',
        status: 'active',
        image: null,
        image_count: 1,
        images: [{ id: 7, url: 'https://example.test/current.jpg', thumbnail_url: null }],
        video_url: null,
        category: null,
        user: null,
        is_saved: false,
        is_own: true,
        is_promoted: false,
        views_count: 0,
        saves_count: 0,
        created_at: '2026-05-01T00:00:00Z',
        latitude: null,
        longitude: null,
        shipping_available: false,
        local_pickup: true,
        template_data: null,
      },
    } as never);
    jest.mocked(updateMarketplaceListing).mockResolvedValue({ data: { id: 43 } } as never);
    jest.mocked(uploadMarketplaceImages).mockResolvedValue({ data: [] } as never);

    const { getByText } = render(<NewMarketplaceListingRoute />);

    await waitFor(() => expect(getByText('Cover')).toBeTruthy());
    fireEvent.press(getByText('Add images'));

    await waitFor(() => {
      expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        selectionLimit: 19,
      }));
    });

    fireEvent.press(getByText('Update'));

    await waitFor(() => {
      expect(uploadMarketplaceImages).toHaveBeenCalledWith(43, ['file:///tmp/new-photo.jpg']);
    });
    expect(deleteMarketplaceListingImage).not.toHaveBeenCalled();
  });
});
