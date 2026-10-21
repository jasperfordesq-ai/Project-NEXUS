// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Which notification-centre category a notification type falls into.
 *
 * Wellbeing deep audit (21 Oct 2026): a `volunteer_wellbeing` notification — a
 * volunteer said they are low or struggling and asked for someone to get in touch,
 * or the nightly scan raised a new high/critical alert — is safeguarding work. It
 * fell through to "other", so it looked like any system notice and was missing
 * from the place staff look for safeguarding. The server files it under
 * `safeguarding` too.
 */

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  getNotifications: jest.fn(),
  getNotification: jest.fn(),
  getGroupedNotifications: jest.fn(),
  getNotificationUnreadCount: jest.fn(),
  markNotificationRead: jest.fn(),
  markAllNotificationsRead: jest.fn(),
  markNotificationGroupRead: jest.fn(),
  deleteAllNotifications: jest.fn(),
  deleteNotification: jest.fn()
}));

const { categoryFromType } = require('../src/routes/notifications');

describe('notification categories', () => {
  it('files a volunteer wellbeing notification under safeguarding', () => {
    expect(categoryFromType('volunteer_wellbeing')).toBe('safeguarding');
    expect(categoryFromType('VOLUNTEER_WELLBEING')).toBe('safeguarding');
  });

  it('leaves the existing rules alone', () => {
    expect(categoryFromType('safeguarding_report')).toBe('safeguarding');
    expect(categoryFromType('broker_alert')).toBe('safeguarding');
    expect(categoryFromType('new_message')).toBe('messages');
    expect(categoryFromType('event_reminder')).toBe('events');
    expect(categoryFromType('system')).toBe('system');
    expect(categoryFromType('something_new')).toBe('other');
    expect(categoryFromType(null)).toBe('other');
  });
});
