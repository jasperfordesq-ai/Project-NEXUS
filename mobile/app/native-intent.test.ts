// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { mapSystemPathToNativeRoute, redirectSystemPath } from './+native-intent';

describe('native intent route rewriting', () => {
  it('maps Android listing and group app links to implemented modal routes', () => {
    expect(mapSystemPathToNativeRoute('nexus:///listings/90877')).toBe('/(modals)/exchange-detail?id=90877');
    expect(mapSystemPathToNativeRoute('https://app.project-nexus.ie/groups/90106')).toBe('/(modals)/group-detail?id=90106');
  });

  it('maps profile parity links to native member, appreciations, and collections routes', () => {
    expect(mapSystemPathToNativeRoute('/users/25717')).toBe('/(modals)/member-profile?id=25717');
    expect(mapSystemPathToNativeRoute('/users/25717/appreciations')).toBe('/(modals)/appreciations?userId=25717');
    expect(mapSystemPathToNativeRoute('/users/25717/collections')).toBe('/(modals)/profile-collections?userId=25717&scope=public');
  });

  it('keeps the current-member profile link on the Profile tab', () => {
    expect(mapSystemPathToNativeRoute('/profile')).toBe('/(tabs)/profile');
    expect(mapSystemPathToNativeRoute('/profile/25717')).toBe('/(modals)/member-profile?id=25717');
  });

  it('maps push-producer seller and job workflow links to actionable native screens', () => {
    expect(mapSystemPathToNativeRoute('/marketplace/seller/dashboard')).toBe('/(modals)/marketplace-tools');
    expect(mapSystemPathToNativeRoute('/jobs/44/applications')).toBe('/(modals)/job-pipeline?id=44');
    expect(mapSystemPathToNativeRoute('/volunteering/7')).toBe('/(modals)/volunteering-detail?id=7');
    expect(mapSystemPathToNativeRoute('/endorsements')).toBe('/(modals)/endorsements');
    expect(mapSystemPathToNativeRoute('/marketplace/offers')).toBe('/(modals)/marketplace-offers');
    expect(mapSystemPathToNativeRoute('/marketplace/tools')).toBe('/(modals)/marketplace-tools');
  });

  it('maps create aliases to native create surfaces', () => {
    expect(mapSystemPathToNativeRoute('/listings/new')).toBe('/(modals)/new-exchange');
    expect(mapSystemPathToNativeRoute('/events/create')).toBe('/(modals)/new-event');
    expect(mapSystemPathToNativeRoute('/groups/new')).toBe('/(modals)/new-group');
    expect(mapSystemPathToNativeRoute('/polls/new')).toBe('/(modals)/polls?create=1');
    expect(mapSystemPathToNativeRoute('/challenges/new')).toBe('/(modals)/new-challenge');
  });

  it('maps messages and ideation links without going through unmatched routes', () => {
    expect(mapSystemPathToNativeRoute('nexus:///messages/new')).toBe('/(modals)/new-message');
    expect(mapSystemPathToNativeRoute('/messages/new/260?listing=90877')).toBe('/(modals)/thread?listing=90877&recipientId=260');
    expect(mapSystemPathToNativeRoute('/messages?user=25717&context=event&context_id=12&name=E2E%20Admin')).toBe(
      '/(modals)/thread?context_id=12&name=E2E+Admin&context_type=event&recipientId=25717',
    );
    expect(mapSystemPathToNativeRoute('/ideation/23')).toBe('/(modals)/ideation-detail?id=23');
  });

  it('maps discover and support/legal web aliases to implemented native routes', () => {
    expect(mapSystemPathToNativeRoute('/explore')).toBe('/(tabs)/explore');
    expect(mapSystemPathToNativeRoute('/discover')).toBe('/(tabs)/explore');
    expect(mapSystemPathToNativeRoute('nexus:///support')).toBe('/(modals)/support');
    expect(mapSystemPathToNativeRoute('/legal')).toBe('/(modals)/support');
    expect(mapSystemPathToNativeRoute('/privacy')).toBe('/(modals)/support?doc=privacy');
    expect(mapSystemPathToNativeRoute('/terms')).toBe('/(modals)/support?doc=terms');
    expect(mapSystemPathToNativeRoute('/trust-and-safety')).toBe('/(modals)/support?doc=trust');
    expect(mapSystemPathToNativeRoute('/platform/privacy')).toBe('/(modals)/support?doc=privacy');
  });

  it('preserves unknown paths so Expo Router can handle native routes normally', () => {
    expect(mapSystemPathToNativeRoute('/(modals)/exchange-detail?id=90877')).toBeNull();
    expect(redirectSystemPath({ path: '/(modals)/exchange-detail?id=90877', initial: false })).toBe('/(modals)/exchange-detail?id=90877');
  });

  it('rejects untrusted web origins and non-https links', () => {
    expect(mapSystemPathToNativeRoute('https://evil.example/messages/123')).toBeNull();
    expect(mapSystemPathToNativeRoute('http://app.project-nexus.ie/messages/123')).toBeNull();
    expect(mapSystemPathToNativeRoute('javascript:alert(1)')).toBeNull();
  });
});
