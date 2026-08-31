// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn(), upload: jest.fn() },
}));

jest.mock('@/lib/constants', () => ({
  API_V2: '/api/v2',
}));

import { api } from '@/lib/api/client';
import {
  acceptMarketplaceCounterOffer,
  acceptMarketplaceDeliveryOffer,
  createMarketplaceListing,
  createMarketplaceOrder,
  createMarketplaceCollection,
  createMarketplaceDeliveryOffer,
  createMarketplacePaymentIntent,
  createMarketplacePickupSlot,
  createMarketplaceShippingOption,
  createMarketplaceSavedSearch,
  createMerchantCoupon,
  completeMerchantOnboarding,
  cancelMarketplaceOrder,
  confirmMarketplacePayment,
  confirmMarketplaceOrderDelivery,
  confirmMarketplaceDeliveryOffer,
  deleteMarketplaceShippingOption,
  disputeMarketplaceOrder,
  getMarketplaceCategories,
  getMarketplaceCategoryTemplate,
  getMarketplaceCollectionItems,
  getMarketplaceCollections,
  getGroupMarketplaceListings,
  getGroupMarketplaceStats,
  getMarketplaceListing,
  getMarketplaceOrder,
  getMarketplaceListingPickupSlots,
  getMarketplaceListings,
  getMarketplaceOrders,
  getMarketplaceOrderRatings,
  getMarketplaceDeliveryOffers,
  getMarketplaceOffers,
  getMarketplacePickupSlots,
  getMarketplaceShippingOptions,
  getMarketplaceSavedSearches,
  getMarketplaceSellerBalance,
  getMarketplaceSellerShippingOptions,
  getMarketplaceSellerPayouts,
  getMarketplaceStripeOnboardingStatus,
  getMerchantCouponRedemptions,
  getMerchantOnboardingStatus,
  getNearbyMarketplaceListings,
  getPublicMerchantCoupon,
  getPublicMerchantCoupons,
  getMyMarketplaceListings,
  getMyMarketplacePickups,
  getMyMarketplacePromotions,
  makeMarketplaceOffer,
  marketplaceHasMore,
  marketplaceNextCursor,
  promoteMarketplaceListing,
  counterMarketplaceOffer,
  rateMarketplaceOrder,
  reportMarketplaceListing,
  removeMarketplaceCollectionItem,
  reserveMarketplacePickup,
  scanMarketplacePickup,
  saveMerchantOnboardingStep1,
  saveMerchantOnboardingStep2,
  saveMerchantOnboardingStep3,
  startMarketplaceStripeOnboarding,
  generatePublicMerchantCouponQr,
  generateMarketplaceDescription,
  shipMarketplaceOrder,
  updateMarketplaceShippingOption,
  updateMarketplaceListing,
  updateMerchantCoupon,
  uploadMarketplaceImages,
  uploadMarketplaceVideo,
  deleteMarketplaceVideo,
  validateMarketplaceCoupon,
} from './marketplace';

describe('marketplace api', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads marketplace listings with web parity filters', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [], meta: { cursor: null, has_more: false } });

    await getMarketplaceListings({
      q: 'bike',
      category_id: 3,
      price_min: 10,
      price_max: 100,
      price_type: 'free',
      condition: 'good,fair',
      seller_type: 'business',
      delivery_method: 'pickup',
      sort: 'newest',
      posted_within: 7,
      cursor: 'abc',
      limit: 24,
    });

    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/listings', {
      q: 'bike',
      category_id: '3',
      price_min: '10',
      price_max: '100',
      price_type: 'free',
      condition: 'good,fair',
      seller_type: 'business',
      delivery_method: 'pickup',
      sort: 'newest',
      posted_within: '7',
      cursor: 'abc',
      limit: '24',
    });
  });

  it('loads current user listings with user_id and status scope', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [] });
    await getMyMarketplaceListings(null, 42, 'draft');
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/listings', {
      limit: '20',
      sort: 'newest',
      status: 'draft',
      user_id: '42',
    });
  });

  it('loads nearby marketplace listings with backend geolocation params', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [] });

    await getNearbyMarketplaceListings({ latitude: 51.55, longitude: -9.26, radius: 50, limit: 30 });

    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/listings/nearby', {
      latitude: '51.55',
      longitude: '-9.26',
      radius: '50',
      limit: '30',
    });
  });

  it('wires group marketplace listings and stats', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [], meta: { cursor: null, has_more: false } });

    await getGroupMarketplaceListings(12, {
      category_id: 3,
      search: 'tools',
      condition: 'good',
      sort: 'popular',
      cursor: 'next',
      limit: 20,
    });

    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/groups/12/listings', {
      category_id: '3',
      search: 'tools',
      condition: 'good',
      sort: 'popular',
      cursor: 'next',
      limit: '20',
    });

    await getGroupMarketplaceStats(12);
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/groups/12/stats');
  });

  it('uses the backend category and detail endpoints', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [] });
    await getMarketplaceCategories();
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/categories');

    await getMarketplaceListing(9);
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/listings/9');

    await getMarketplaceListing(9, 31);
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/listings/9', { offer_id: '31' });

    await getMarketplaceCategoryTemplate(3);
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/categories/3/template');
  });

  it('creates and updates listings with marketplace payloads', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { id: 1 } });
    (api.put as jest.Mock).mockResolvedValue({ data: { id: 1 } });
    const payload = {
      title: 'Garden table',
      description: 'Solid table',
      price_type: 'fixed' as const,
      price: 25,
      condition: 'good' as const,
      inventory_count: 4,
      low_stock_threshold: 1,
      is_oversold_protected: true,
      latitude: 51.5007,
      longitude: -0.1246,
      delivery_method: 'pickup' as const,
      template_data: { frame_size: 'Medium' },
    };

    await createMarketplaceListing(payload);
    expect(api.post).toHaveBeenCalledWith('/api/v2/marketplace/listings', payload);

    await updateMarketplaceListing(1, { title: 'Updated', inventory_count: null });
    expect(api.put).toHaveBeenCalledWith('/api/v2/marketplace/listings/1', { title: 'Updated', inventory_count: null });

    await generateMarketplaceDescription({ title: 'Garden table', category: 'Furniture', condition: 'good' });
    expect(api.post).toHaveBeenCalledWith('/api/v2/marketplace/listings/generate-description', {
      title: 'Garden table',
      category: 'Furniture',
      condition: 'good',
    });
  });

  it('creates and loads offers', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { id: 1 } });
    (api.put as jest.Mock).mockResolvedValue({ data: { id: 1 } });
    (api.get as jest.Mock).mockResolvedValue({ data: [], meta: { cursor: null, has_more: false } });

    await makeMarketplaceOffer(8, { amount: 12, message: 'Can collect today' });
    expect(api.post).toHaveBeenCalledWith('/api/v2/marketplace/listings/8/offers', {
      amount: 12,
      message: 'Can collect today',
    });

    await getMarketplaceOffers('received', 'next');
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/my-offers/received', {
      cursor: 'next',
      per_page: '20',
    });

    await counterMarketplaceOffer(8, { amount: 18, message: 'Can include delivery' });
    expect(api.put).toHaveBeenCalledWith('/api/v2/marketplace/offers/8/counter', {
      amount: 18,
      message: 'Can include delivery',
    });

    await acceptMarketplaceCounterOffer(8);
    expect(api.put).toHaveBeenCalledWith('/api/v2/marketplace/offers/8/accept-counter');
  });

  it('normalises pagination metadata variants', () => {
    expect(marketplaceNextCursor({ data: [], meta: { next_cursor: 'next', has_more: true } })).toBe('next');
    expect(marketplaceHasMore({ data: [], meta: { next_cursor: 'next', has_more: true } })).toBe(true);
  });

  it('uploads listing images to the marketplace images endpoint', async () => {
    (api.upload as jest.Mock).mockResolvedValue({ data: [{ id: 1, url: '/uploads/marketplace/a.jpg' }] });

    await uploadMarketplaceImages(8, ['file:///tmp/a.jpg']);

    expect(api.upload).toHaveBeenCalledWith('/api/v2/marketplace/listings/8/images', expect.any(FormData));
  });

  it('wires marketplace listing video upload and removal endpoints', async () => {
    (api.upload as jest.Mock).mockResolvedValue({ data: { video_url: '/uploads/marketplace/demo.mp4' } });
    (api.delete as jest.Mock).mockResolvedValue(undefined);

    await uploadMarketplaceVideo(8, { uri: 'file:///tmp/demo.mp4', fileName: 'demo.mp4', mimeType: 'video/mp4' });
    expect(api.upload).toHaveBeenCalledWith('/api/v2/marketplace/listings/8/video', expect.any(FormData));

    await deleteMarketplaceVideo(8);
    expect(api.delete).toHaveBeenCalledWith('/api/v2/marketplace/listings/8/video');
  });

  it('wires marketplace discovery collections and saved searches', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [] });
    (api.post as jest.Mock).mockResolvedValue({ data: { id: 1 } });

    await getMarketplaceCollections();
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/collections');

    await getMarketplaceCollectionItems(7, null, 50);
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/collections/7/items', {
      limit: '50',
    });

    await removeMarketplaceCollectionItem(7, 99);
    expect(api.delete).toHaveBeenCalledWith('/api/v2/marketplace/collections/7/items/99');

    await createMarketplaceCollection({ name: 'Garden kit', description: 'Useful things', is_public: false });
    expect(api.post).toHaveBeenCalledWith('/api/v2/marketplace/collections', {
      name: 'Garden kit',
      description: 'Useful things',
      is_public: false,
    });

    await getMarketplaceSavedSearches();
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/saved-searches');

    await createMarketplaceSavedSearch({ name: 'Bikes', search_query: 'bike', alert_frequency: 'daily', alert_channel: 'push' });
    expect(api.post).toHaveBeenCalledWith('/api/v2/marketplace/saved-searches', {
      name: 'Bikes',
      search_query: 'bike',
      alert_frequency: 'daily',
      alert_channel: 'push',
    });
  });

  it('wires promotions, pickups, and seller coupons', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [] });
    (api.post as jest.Mock).mockResolvedValue({ data: { id: 1 } });

    await getMyMarketplacePromotions();
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/promotions/mine');

    await promoteMarketplaceListing(9, 'featured');
    expect(api.post).toHaveBeenCalledWith('/api/v2/marketplace/listings/9/promote', { promotion_type: 'featured' });

    await getMarketplacePickupSlots();
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/seller/pickup-slots');

    await createMarketplacePickupSlot({ slot_start: '2026-06-01 10:00', slot_end: '2026-06-01 12:00', capacity: 4 });
    expect(api.post).toHaveBeenCalledWith('/api/v2/marketplace/seller/pickup-slots', {
      slot_start: '2026-06-01 10:00',
      slot_end: '2026-06-01 12:00',
      capacity: 4,
    });

    await getMarketplaceShippingOptions();
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/seller/shipping-options');

    await createMarketplaceShippingOption({ courier_name: 'An Post', price: 6.5, currency: 'EUR', estimated_days: 3, is_default: true });
    expect(api.post).toHaveBeenCalledWith('/api/v2/marketplace/seller/shipping-options', {
      courier_name: 'An Post',
      price: 6.5,
      currency: 'EUR',
      estimated_days: 3,
      is_default: true,
    });

    await updateMarketplaceShippingOption(4, { courier_name: 'Courier', price: 8 });
    expect(api.put).toHaveBeenCalledWith('/api/v2/marketplace/seller/shipping-options/4', {
      courier_name: 'Courier',
      price: 8,
    });

    await deleteMarketplaceShippingOption(4);
    expect(api.delete).toHaveBeenCalledWith('/api/v2/marketplace/seller/shipping-options/4');

    await getMyMarketplacePickups();
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/me/pickups');

    await scanMarketplacePickup('abc123');
    expect(api.post).toHaveBeenCalledWith('/api/v2/marketplace/seller/pickup-scan', { qr_code: 'abc123' });

    await createMerchantCoupon({ title: 'June discount', discount_type: 'percent', discount_value: 10, status: 'active' });
    expect(api.post).toHaveBeenCalledWith('/api/v2/marketplace/seller/coupons', {
      title: 'June discount',
      discount_type: 'percent',
      discount_value: 10,
      status: 'active',
    });

    await updateMerchantCoupon(5, { code: 'JULY20', title: 'July discount', status: 'paused', max_uses: 20 });
    expect(api.put).toHaveBeenCalledWith('/api/v2/marketplace/seller/coupons/5', {
      code: 'JULY20',
      title: 'July discount',
      status: 'paused',
      max_uses: 20,
    });

    await getMerchantCouponRedemptions(5);
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/seller/coupons/5/redemptions');

    await getPublicMerchantCoupons();
    expect(api.get).toHaveBeenCalledWith('/api/v2/coupons');

    await getPublicMerchantCoupon(7);
    expect(api.get).toHaveBeenCalledWith('/api/v2/coupons/7');

    await generatePublicMerchantCouponQr(7);
    expect(api.post).toHaveBeenCalledWith('/api/v2/coupons/7/qr', {});
  });

  it('wires checkout payment, pickup reservation, and coupon validation', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [] });
    (api.post as jest.Mock).mockResolvedValue({ data: { checkout_url: 'https://checkout.test' } });

    await getMarketplaceListingPickupSlots(9);
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/listings/9/pickup-slots');

    await getMarketplaceListingPickupSlots(9, 31);
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/listings/9/pickup-slots', { offer_id: '31' });

    await getMarketplaceSellerShippingOptions(22);
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/sellers/22/shipping-options');

    await createMarketplaceOrder({
      listing_id: 9,
      quantity: 1,
      idempotency_key: 'mobile-marketplace-checkout-9',
      shipping_method: 'pickup',
      pickup_slot_id: 3,
    });
    expect(api.post).toHaveBeenCalledWith('/api/v2/marketplace/orders', {
      listing_id: 9,
      quantity: 1,
      idempotency_key: 'mobile-marketplace-checkout-9',
      shipping_method: 'pickup',
      pickup_slot_id: 3,
    });

    await reserveMarketplacePickup(14, 3);
    expect(api.post).toHaveBeenCalledWith('/api/v2/marketplace/orders/14/pickup-reservation', {
      slot_id: 3,
    });

    await createMarketplacePaymentIntent(14);
    expect(api.post).toHaveBeenCalledWith('/api/v2/marketplace/payments/create-intent', {
      order_id: 14,
    });

    await confirmMarketplacePayment('pi_14');
    expect(api.post).toHaveBeenCalledWith('/api/v2/marketplace/payments/confirm', {
      payment_intent_id: 'pi_14',
    });

    await validateMarketplaceCoupon({ code: 'SAVE10', listing_id: 9, shipping_option_id: 3 });
    expect(api.post).toHaveBeenCalledWith('/api/v2/coupons/validate', {
      code: 'SAVE10',
      listing_id: 9,
      shipping_option_id: 3,
    });
  });

  it('wires marketplace order lifecycle actions', async () => {
    (api.put as jest.Mock).mockResolvedValue({ data: { id: 14 } });
    (api.post as jest.Mock).mockResolvedValue({ data: { id: 2 } });
    (api.get as jest.Mock).mockResolvedValue({ data: [] });

    await getMarketplaceOrders('purchases', 'next', 'paid,shipped');
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/orders/purchases', {
      cursor: 'next',
      limit: '20',
      status: 'paid,shipped',
    });

    await getMarketplaceOrder(14);
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/orders/14');

    await shipMarketplaceOrder(14, {
      tracking_number: 'TRACK123',
      tracking_url: 'https://tracking.test/TRACK123',
      shipping_method: 'tracked',
    });
    expect(api.put).toHaveBeenCalledWith('/api/v2/marketplace/orders/14/ship', {
      tracking_number: 'TRACK123',
      tracking_url: 'https://tracking.test/TRACK123',
      shipping_method: 'tracked',
    });

    await confirmMarketplaceOrderDelivery(14);
    expect(api.put).toHaveBeenCalledWith('/api/v2/marketplace/orders/14/confirm-delivery');

    await cancelMarketplaceOrder(14, 'Changed plans');
    expect(api.put).toHaveBeenCalledWith('/api/v2/marketplace/orders/14/cancel', {
      reason: 'Changed plans',
    });

    await rateMarketplaceOrder(14, { rating: 5, comment: 'Great order', is_anonymous: false });
    expect(api.post).toHaveBeenCalledWith('/api/v2/marketplace/orders/14/rate', {
      rating: 5,
      comment: 'Great order',
      is_anonymous: false,
    });

    await disputeMarketplaceOrder(14, { reason: 'not_received', description: 'The item has not arrived.' });
    expect(api.post).toHaveBeenCalledWith('/api/v2/marketplace/orders/14/dispute', {
      reason: 'not_received',
      description: 'The item has not arrived.',
    });

    await getMarketplaceOrderRatings(14);
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/orders/14/ratings');

    await getMarketplaceDeliveryOffers(14);
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/orders/14/delivery-offers');

    await createMarketplaceDeliveryOffer(14, { time_credits: 1.5, estimated_minutes: 45, notes: 'I can deliver after lunch' });
    expect(api.post).toHaveBeenCalledWith('/api/v2/marketplace/orders/14/delivery-offers', {
      time_credits: 1.5,
      estimated_minutes: 45,
      notes: 'I can deliver after lunch',
    });

    await acceptMarketplaceDeliveryOffer(14, 77);
    expect(api.put).toHaveBeenCalledWith('/api/v2/marketplace/orders/14/delivery-offers/77/accept');

    await confirmMarketplaceDeliveryOffer(14, 77);
    expect(api.put).toHaveBeenCalledWith('/api/v2/marketplace/orders/14/delivery-offers/77/confirm');
  });

  it('wires marketplace listing report notices', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { id: 3, status: 'open' } });

    await reportMarketplaceListing(9, {
      reason: 'misleading',
      description: 'The listing description appears misleading.',
      evidence_urls: ['https://example.test/evidence'],
    });

    expect(api.post).toHaveBeenCalledWith('/api/v2/marketplace/listings/9/report', {
      reason: 'misleading',
      description: 'The listing description appears misleading.',
      evidence_urls: ['https://example.test/evidence'],
    });
  });

  it('wires merchant and Stripe onboarding endpoints', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: { onboarding_completed: false, profile: null } });
    (api.post as jest.Mock).mockResolvedValue({ data: { profile: { id: 1 } } });

    await getMerchantOnboardingStatus();
    expect(api.get).toHaveBeenCalledWith('/api/v2/merchant-onboarding/status');

    await saveMerchantOnboardingStep1({
      seller_type: 'business',
      business_name: 'Nexus Shop',
      display_name: 'Nexus Shop',
      bio: 'Community seller',
      business_registration: null,
    });
    expect(api.post).toHaveBeenCalledWith('/api/v2/merchant-onboarding/step-1', {
      seller_type: 'business',
      business_name: 'Nexus Shop',
      display_name: 'Nexus Shop',
      bio: 'Community seller',
      business_registration: null,
    });

    await saveMerchantOnboardingStep2({ business_address: { city: 'Cork' } });
    expect(api.post).toHaveBeenCalledWith('/api/v2/merchant-onboarding/step-2', {
      business_address: { city: 'Cork' },
    });

    await saveMerchantOnboardingStep3({ avatar_url: '/uploads/avatar.jpg', cover_image_url: null });
    expect(api.post).toHaveBeenCalledWith('/api/v2/merchant-onboarding/step-3', {
      avatar_url: '/uploads/avatar.jpg',
      cover_image_url: null,
    });

    await completeMerchantOnboarding();
    expect(api.post).toHaveBeenCalledWith('/api/v2/merchant-onboarding/complete', {});

    await getMarketplaceStripeOnboardingStatus();
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/seller/onboard/status');

    await getMarketplaceSellerBalance();
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/seller/balance');

    await getMarketplaceSellerPayouts(2, 10);
    expect(api.get).toHaveBeenCalledWith('/api/v2/marketplace/seller/payouts', {
      page: '2',
      limit: '10',
    });

    await startMarketplaceStripeOnboarding();
    expect(api.post).toHaveBeenCalledWith('/api/v2/marketplace/seller/onboard', {});
  });
});
