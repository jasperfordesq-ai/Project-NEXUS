// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import {
  isNativeHrefDisabled,
  setNavigationTenantCapabilities,
} from './tenantCapabilityStore';

describe('notification destination tenant capabilities', () => {
  beforeEach(() => setNavigationTenantCapabilities(null));

  it('does not reject an unknown or offline capability snapshot', () => {
    expect(isNativeHrefDisabled('/events/44')).toBe(false);

    setNavigationTenantCapabilities({ features: {}, modules: {} });
    expect(isNativeHrefDisabled('/route-with-no-capability')).toBe(false);
  });

  it.each([
    ['/feed-item-detail?id=1&type=poll', 'polls', 'feature'],
    ['/feed-item-detail?id=1&type=resource', 'resources', 'feature'],
    ['/feed-item-detail?id=1&type=post', 'feed', 'module'],
    ['/group-exchange/1', 'group_exchanges', 'feature'],
    ['/groups/1', 'groups', 'feature'],
    ['/events/1', 'events', 'feature'],
    ['/volunteering/opportunities/1', 'volunteering', 'feature'],
    ['/donation-receipt/1', 'volunteering', 'feature'],
    ['/jobs/1', 'job_vacancies', 'feature'],
    ['/deliverables/1', 'job_vacancies', 'feature'],
    ['/marketplace/1', 'marketplace', 'feature'],
    ['/federation/connections', 'federation', 'feature'],
    ['/connections', 'connections', 'feature'],
    ['/network', 'connections', 'feature'],
    ['/courses/1', 'courses', 'feature'],
    ['/goals/1', 'goals', 'feature'],
    ['/ideation/1', 'ideation_challenges', 'feature'],
    ['/new-challenge', 'ideation_challenges', 'feature'],
    ['/polls/1', 'polls', 'feature'],
    ['/reviews', 'reviews', 'feature'],
    ['/resource-detail/1', 'resources', 'feature'],
    ['/blog/1', 'blog', 'feature'],
    ['/achievements', 'gamification', 'feature'],
    ['/leaderboard', 'gamification', 'feature'],
    ['/challenge/1', 'gamification', 'feature'],
    ['/search', 'search', 'feature'],
    ['/premium', 'member_premium', 'feature'],
    ['/messages/1', 'direct_messaging', 'feature'],
    ['/thread/1', 'direct_messaging', 'feature'],
    ['/wallet', 'wallet', 'module'],
    ['/feed', 'feed', 'module'],
    ['/exchange-request/1', 'exchange_workflow', 'feature'],
    ['/exchanges/1', 'listings', 'module'],
    ['/listings/1', 'listings', 'module'],
    ['/member-profile/1', 'profile', 'module'],
    ['/profile-collections', 'profile', 'module'],
    ['/appreciations', 'profile', 'module'],
    ['/settings', 'settings', 'module'],
    ['/notifications', 'notifications', 'module'],
    ['/home', 'dashboard', 'module'],
  ] as const)('rejects %s when its %s capability is disabled', (href, key, kind) => {
    setNavigationTenantCapabilities({
      features: kind === 'feature' ? { [key]: false } : {},
      modules: kind === 'module' ? { [key]: false } : {},
    });

    expect(isNativeHrefDisabled(href)).toBe(true);
  });

  it('allows a destination when every declared requirement is enabled', () => {
    setNavigationTenantCapabilities({
      features: { direct_messaging: true, polls: true },
      modules: { messages: true, feed: true },
    });

    expect(isNativeHrefDisabled('/messages/1')).toBe(false);
    expect(isNativeHrefDisabled('/feed-item-detail?id=1&type=poll')).toBe(false);
  });
});
