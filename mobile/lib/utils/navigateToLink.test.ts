// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Linking } from 'react-native';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockCaptureMessage = jest.fn();
const mockOpenURL = jest.spyOn(Linking, 'openURL');

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
import { setNavigationTenantCapabilities } from '@/lib/navigation/tenantCapabilityStore';

describe('navigateToLink', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOpenURL.mockResolvedValue(undefined);
    setNavigationTenantCapabilities(null);
  });

  it('opens an approved external campaign destination in the system browser', () => {
    navigateToLink('https://partner.example.org/book/42?campaign=nexus');

    expect(mockOpenURL).toHaveBeenCalledWith('https://partner.example.org/book/42?campaign=nexus');
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  /**
   * 🔴 The query string is the whole point of these three. This function is what
   * `_layout.tsx` replays a cold-start link through, and it used to push the section
   * without its parameters — so a link naming a tab, a filter or a category opened the
   * screen's default and looked, from the outside, like the screen ignoring the link.
   * Measured on a device on 2026-08-24: `volunteering?tab=donations` produced two
   * volunteering screens, the parameterised one underneath and this one on top.
   */
  it('carries a link query through to a section screen', () => {
    navigateToLink('https://app.project-nexus.ie/volunteering?tab=donations');

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(modals)/volunteering',
      params: { tab: 'donations' },
    });
  });

  it('still pushes a bare route when the link has no query', () => {
    navigateToLink('https://app.project-nexus.ie/volunteering');

    expect(mockPush).toHaveBeenCalledWith('/(modals)/volunteering');
  });

  it.each([
    ['/events/44', 'events', 'feature'],
    ['/marketplace/44', 'marketplace', 'feature'],
    ['/messages/5', 'direct_messaging', 'feature'],
    ['/polls/5', 'polls', 'feature'],
    ['/resources/5', 'resources', 'feature'],
    ['/wallet', 'wallet', 'module'],
    ['/feed/posts/12', 'feed', 'module'],
  ] as const)('falls back to the notification centre when %s belongs to a disabled tenant capability', (link, key, kind) => {
    setNavigationTenantCapabilities({
      features: kind === 'feature' ? { [key]: false } : {},
      modules: kind === 'module' ? { [key]: false } : {},
    });

    navigateToLink(link);

    expect(mockPush).toHaveBeenCalledWith('/(modals)/notifications');
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not reject a valid route when tenant capabilities are unavailable offline', () => {
    setNavigationTenantCapabilities(null);

    navigateToLink('/events/44');

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(modals)/event-detail',
      params: { id: '44' },
    });
  });

  it('never lets a query id override the record named in the path', () => {
    navigateToLink('https://app.project-nexus.ie/groups/974?id=1&tab=files');

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(modals)/group-detail',
      params: { tab: 'files', id: '974' },
    });
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

  it('uses the host as the section for foreground custom-scheme links', () => {
    navigateToLink('nexus://messages');
    navigateToLink('nexus://events');
    navigateToLink('nexus://settings?tab=notifications');

    expect(mockReplace).toHaveBeenNthCalledWith(1, '/(tabs)/messages');
    expect(mockReplace).toHaveBeenNthCalledWith(2, '/(tabs)/events');
    expect(mockPush).toHaveBeenNthCalledWith(1, {
      pathname: '/(modals)/settings',
      params: { tab: 'notifications' },
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

    expect(mockPush).toHaveBeenNthCalledWith(1, '/(modals)/profile-collections');
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

  it('uses the complete App Link mapper for notification-only module destinations', () => {
    navigateToLink('/courses/timebanking-basics');
    navigateToLink('/feed/posts/12');
    navigateToLink('/connections');
    navigateToLink('/dashboard');

    expect(mockPush).toHaveBeenNthCalledWith(1, {
      pathname: '/(modals)/course-detail',
      params: { id: 'timebanking-basics' },
    });
    expect(mockPush).toHaveBeenNthCalledWith(2, {
      pathname: '/(modals)/feed-item-detail',
      params: { type: 'post', id: '12' },
    });
    expect(mockPush).toHaveBeenNthCalledWith(3, '/(modals)/connections');
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/home');
  });

  it('opens social poll and resource notifications on the referenced item, not a list or KB article', () => {
    navigateToLink('/polls/12');
    navigateToLink('/resources/34');

    expect(mockPush).toHaveBeenNthCalledWith(1, {
      pathname: '/(modals)/feed-item-detail',
      params: { type: 'poll', id: '12' },
    });
    expect(mockPush).toHaveBeenNthCalledWith(2, {
      pathname: '/(modals)/feed-item-detail',
      params: { type: 'resource', id: '34' },
    });
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
    expect(mockPush).toHaveBeenNthCalledWith(3, { pathname: '/(modals)/marketplace-category', params: { slug: 'furniture' } });
    expect(mockPush).toHaveBeenNthCalledWith(4, { pathname: '/(modals)/marketplace-seller', params: { id: '8' } });
    expect(mockPush).toHaveBeenNthCalledWith(5, { pathname: '/(modals)/marketplace-collections', params: { tab: 'saved' } });
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

  it('keeps foreground create aliases on create screens instead of treating them as record ids', () => {
    navigateToLink('nexus://listings/create');
    navigateToLink('/exchanges/new');
    navigateToLink('/events/create?from=calendar');
    navigateToLink('/groups/new');
    navigateToLink('/jobs/create');
    navigateToLink('/volunteering/new');
    navigateToLink('/polls/create');

    expect(mockPush).toHaveBeenNthCalledWith(1, '/(modals)/new-exchange');
    expect(mockPush).toHaveBeenNthCalledWith(2, '/(modals)/new-exchange');
    expect(mockPush).toHaveBeenNthCalledWith(3, {
      pathname: '/(modals)/new-event',
      params: { from: 'calendar' },
    });
    expect(mockPush).toHaveBeenNthCalledWith(4, '/(modals)/new-group');
    expect(mockPush).toHaveBeenNthCalledWith(5, '/(modals)/new-job');
    expect(mockPush).toHaveBeenNthCalledWith(6, '/(modals)/new-volunteering');
    expect(mockPush).toHaveBeenNthCalledWith(7, {
      pathname: '/(modals)/polls',
      params: { create: '1' },
    });
  });
});
