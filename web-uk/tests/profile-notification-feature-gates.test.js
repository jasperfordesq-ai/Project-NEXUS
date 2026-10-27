// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Notification preferences must omit controls for switched-off capabilities
 * (React 4e1e6fec, NotificationsTab). The accessible settings page offered
 * every toggle to every community — including email about events, the wallet
 * or reviews where those do not exist.
 *
 * Just as important: the save must not send a hidden key. The API updates only
 * the keys it receives (UsersController::updateNotificationPreferences), so an
 * unshown checkbox posted as "off" would silently overwrite the member's real
 * choice for that capability.
 */

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() })
}));

const profileRoutes = require('../src/routes/profile');

const { notificationGroupKeys, notificationPayload } = profileRoutes;

function allKeys(tenant) {
  return notificationGroupKeys(tenant).flatMap(([, keys]) => keys);
}

describe('notification toggles follow the community switches', () => {
  it('keeps the everyday toggles when nothing is switched off', () => {
    const keys = allKeys({});
    for (const key of ['email_messages', 'email_connections', 'email_listings', 'email_events',
      'email_transactions', 'email_reviews', 'email_gamification_digest', 'email_digest', 'push_enabled']) {
      expect(keys).toContain(key);
    }
  });

  it.each([
    ['messages', 'modules', 'email_messages'],
    ['listings', 'modules', 'email_listings'],
    ['wallet', 'modules', 'email_transactions'],
    ['connections', 'features', 'email_connections'],
    ['events', 'features', 'email_events'],
    ['reviews', 'features', 'email_reviews'],
    ['gamification', 'features', 'email_gamification_digest'],
    ['gamification', 'features', 'email_gamification_milestones'],
    ['federation', 'features', 'federation_notifications_enabled'],
    ['organisations', 'features', 'email_org_payments'],
    ['volunteering', 'features', 'email_org_admin']
  ])('drops the toggle when %s is off', (flag, source, key) => {
    expect(allKeys({ [source]: { [flag]: false } })).not.toContain(key);
    expect(allKeys({ [source]: { [flag]: true } })).toContain(key);
  });

  it('never offers a toggle for a module that is off by default', () => {
    expect(allKeys({})).not.toContain('caring_smart_nudges');
  });

  it('drops a group that has nothing left in it', () => {
    const groups = notificationGroupKeys({ features: { gamification: false } }).map(([group]) => group);
    // email_digest keeps the achievements group alive.
    expect(groups).toContain('achievements');
    const noOrg = notificationGroupKeys({ features: { organisations: false } }).map(([group]) => group);
    expect(noOrg).not.toContain('organisation');
  });
});

describe('the save sends only the toggles that were shown', () => {
  it('omits keys for switched-off capabilities', () => {
    const payload = notificationPayload({ email_messages: '1' }, { modules: { wallet: false }, features: { events: false } });
    expect(payload.email_messages).toBe(true);
    expect(payload).not.toHaveProperty('email_transactions');
    expect(payload).not.toHaveProperty('email_events');
    expect(payload).not.toHaveProperty('caring_smart_nudges');
    expect(payload.email_listings).toBe(false);
  });

  it('omits the federation preference where federation is off', () => {
    expect(notificationPayload({}, { features: { federation: false } })).not.toHaveProperty('federation_notifications_enabled');
    expect(notificationPayload({ federation_notifications_enabled: '1' }, {}).federation_notifications_enabled).toBe(true);
  });
});
