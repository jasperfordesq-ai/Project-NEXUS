// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockCaptureMessage = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
}));

jest.mock('@sentry/react-native', () => ({
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
}));

import { navigateToLink } from './navigateToLink';

describe('navigateToLink', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps federation directory deep links to their native screens', () => {
    navigateToLink('/federation/partners');
    navigateToLink('/federation/members?partner_id=2');
    navigateToLink('/federation/messages?compose=true&to_user=272&to_tenant=5&name=Alice');
    navigateToLink('/federation/listings?partner_id=2');
    navigateToLink('/federation/events');
    navigateToLink('/federation/settings');

    expect(mockPush).toHaveBeenNthCalledWith(1, '/(modals)/federation-partners');
    expect(mockPush).toHaveBeenNthCalledWith(2, { pathname: '/(modals)/federation-members', params: { partner_id: '2' } });
    expect(mockPush).toHaveBeenNthCalledWith(3, {
      pathname: '/(modals)/federation-messages',
      params: { compose: 'true', to_user: '272', to_tenant: '5', name: 'Alice' },
    });
    expect(mockPush).toHaveBeenNthCalledWith(4, { pathname: '/(modals)/federation-listings', params: { partner_id: '2' } });
    expect(mockPush).toHaveBeenNthCalledWith(5, '/(modals)/federation-events');
    expect(mockPush).toHaveBeenNthCalledWith(6, '/(modals)/federation-settings');
  });

  it('maps federation detail deep links with tenant context', () => {
    navigateToLink('/federation/partners/7');
    navigateToLink('/federation/members/272?tenant_id=5');

    expect(mockPush).toHaveBeenNthCalledWith(1, { pathname: '/(modals)/federation-partner', params: { id: '7' } });
    expect(mockPush).toHaveBeenNthCalledWith(2, { pathname: '/(modals)/federation-member', params: { id: '272', tenant_id: '5' } });
  });

  it('maps web message compose links to the native thread composer', () => {
    navigateToLink('/messages/new/260?listing=90624');
    navigateToLink('/messages?user=272&context=job&context_id=44&name=Alice');

    expect(mockPush).toHaveBeenNthCalledWith(1, {
      pathname: '/(modals)/thread',
      params: { recipientId: '260', listing: '90624' },
    });
    expect(mockPush).toHaveBeenNthCalledWith(2, {
      pathname: '/(modals)/thread',
      params: { recipientId: '272', context_type: 'job', context_id: '44', name: 'Alice' },
    });
  });

  it('keeps existing message thread links on the thread route', () => {
    navigateToLink('/messages/5?context_type=event&context_id=12');

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(modals)/thread',
      params: { id: '5', context_type: 'event', context_id: '12' },
    });
  });

  it('maps web user profile and appreciation links to native profile routes', () => {
    navigateToLink('/users/7');
    navigateToLink('/users/7/appreciations');
    navigateToLink('/users/7/collections');

    expect(mockPush).toHaveBeenNthCalledWith(1, {
      pathname: '/(modals)/member-profile',
      params: { id: '7' },
    });
    expect(mockPush).toHaveBeenNthCalledWith(2, {
      pathname: '/(modals)/appreciations',
      params: { userId: '7' },
    });
    expect(mockPush).toHaveBeenNthCalledWith(3, {
      pathname: '/(modals)/profile-collections',
      params: { userId: '7', scope: 'public' },
    });
  });

  it('maps my collection links to the native profile collections route', () => {
    navigateToLink('/me/collections');
    navigateToLink('/me/collections/9');

    expect(mockPush).toHaveBeenNthCalledWith(1, {
      pathname: '/(modals)/profile-collections',
      params: {},
    });
    expect(mockPush).toHaveBeenNthCalledWith(2, {
      pathname: '/(modals)/profile-collections',
      params: { collectionId: '9' },
    });
  });

  it('maps volunteering organisation workflow links to native organiser routes', () => {
    navigateToLink('/volunteering/my-organisations');
    navigateToLink('/volunteering/org/5/dashboard?tab=wallet');

    expect(mockPush).toHaveBeenNthCalledWith(1, {
      pathname: '/(modals)/volunteering',
      params: { tab: 'organisations' },
    });
    expect(mockPush).toHaveBeenNthCalledWith(2, {
      pathname: '/(modals)/volunteering-org-dashboard',
      params: { id: '5', tab: 'wallet' },
    });
  });

  it('maps implemented workflow utility links to native modal routes', () => {
    navigateToLink('/activity');
    navigateToLink('/goals/3');
    navigateToLink('/matches');
    navigateToLink('/reviews');
    navigateToLink('/skills');
    navigateToLink('/polls');
    navigateToLink('/kb/12');
    navigateToLink('/privacy');

    expect(mockPush).toHaveBeenNthCalledWith(1, '/(modals)/activity');
    expect(mockPush).toHaveBeenNthCalledWith(2, { pathname: '/(modals)/goal-detail', params: { id: '3' } });
    expect(mockPush).toHaveBeenNthCalledWith(3, '/(modals)/matches');
    expect(mockPush).toHaveBeenNthCalledWith(4, '/(modals)/reviews');
    expect(mockPush).toHaveBeenNthCalledWith(5, '/(modals)/skills');
    expect(mockPush).toHaveBeenNthCalledWith(6, '/(modals)/polls');
    expect(mockPush).toHaveBeenNthCalledWith(7, { pathname: '/(modals)/kb-article', params: { id: '12' } });
    expect(mockPush).toHaveBeenNthCalledWith(8, { pathname: '/(modals)/support', params: { doc: 'privacy' } });
  });

  it('maps marketplace deep links to native marketplace screens', () => {
    navigateToLink('/marketplace');
    navigateToLink('/marketplace/search?q=lamp');
    navigateToLink('/marketplace/category/furniture');
    navigateToLink('/marketplace/seller/8');
    navigateToLink('/marketplace/saved-searches');
    navigateToLink('/marketplace/44');

    expect(mockPush).toHaveBeenNthCalledWith(1, '/(modals)/marketplace');
    expect(mockPush).toHaveBeenNthCalledWith(2, { pathname: '/(modals)/marketplace-search', params: { q: 'lamp' } });
    expect(mockPush).toHaveBeenNthCalledWith(3, { pathname: '/(modals)/marketplace-category', params: { id: 'furniture' } });
    expect(mockPush).toHaveBeenNthCalledWith(4, { pathname: '/(modals)/marketplace-seller', params: { id: '8' } });
    expect(mockPush).toHaveBeenNthCalledWith(5, { pathname: '/(modals)/marketplace-tools', params: { tab: 'savedSearches' } });
    expect(mockPush).toHaveBeenNthCalledWith(6, { pathname: '/(modals)/marketplace-detail', params: { id: '44' } });
  });

  // 🔴 `exchanges` and `listings` used to share one case, so every exchange
  // notification opened the listing screen and it answered "Listing not found".
  // They are different records with different ids. Keep these two tests
  // together: the bug was invisible while only one of the two was asserted.
  it('sends exchange deep links to the exchange request screens', () => {
    navigateToLink('/exchanges/123');
    navigateToLink('/exchanges');

    expect(mockPush).toHaveBeenNthCalledWith(1, {
      pathname: '/(modals)/exchange-request-detail',
      params: { id: '123' },
    });
    expect(mockPush).toHaveBeenNthCalledWith(2, '/(modals)/exchange-requests');
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('keeps listing deep links on the listing screens, distinct from exchanges', () => {
    navigateToLink('/listings/123');
    navigateToLink('/listings');

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(modals)/exchange-detail',
      params: { id: '123' },
    });
    expect(mockPush).not.toHaveBeenCalledWith({
      pathname: '/(modals)/exchange-request-detail',
      params: { id: '123' },
    });
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/exchanges');
  });
});
