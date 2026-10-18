// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A push tap that ends on Home used to look, in Sentry, exactly like a tap that did
 * nothing: no breadcrumb, no message. The trail here makes the next regression visible,
 * and the detector names it in words.
 */

const mockAddBreadcrumb = jest.fn();
const mockCaptureMessage = jest.fn();

jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: (...args: unknown[]) => mockAddBreadcrumb(...args),
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
  captureException: jest.fn(),
}));

jest.mock('@/lib/storage', () => ({
  storage: { get: jest.fn().mockResolvedValue(null), set: jest.fn(), remove: jest.fn() },
}));

import {
  didPushTapLandOnHome,
  pushLanding,
  PUSH_LANDING_WINDOW_MS,
  recordNavigationIssued,
  recordPushTap,
  recordRedirectDecision,
} from './pushTrail';

describe('didPushTapLandOnHome', () => {
  const expectation = { link: '/messages/7', issuedAt: 1_000, from: '/' };

  it('is true when a message tap ends on Home within the window', () => {
    expect(didPushTapLandOnHome(expectation, '/home', 1_000 + 500)).toBe(true);
  });

  it('is false when the tap reached its own screen', () => {
    expect(didPushTapLandOnHome(expectation, '/thread', 1_000 + 500)).toBe(false);
  });

  it('is false once the window has passed', () => {
    expect(didPushTapLandOnHome(expectation, '/home', 1_000 + PUSH_LANDING_WINDOW_MS + 1)).toBe(false);
  });

  it('is false when the link itself goes to Home', () => {
    expect(didPushTapLandOnHome({ ...expectation, link: '/feed' }, '/home', 1_000 + 500)).toBe(false);
  });

  it('is false with nothing expected', () => {
    expect(didPushTapLandOnHome(null, '/home', 1_000 + 500)).toBe(false);
  });
});

describe('pushLanding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pushLanding.current = null;
  });

  it('reports once when the expected destination turns into Home', () => {
    pushLanding.expect('/messages/7', '/');
    pushLanding.observe('/');
    pushLanding.observe('/home');
    pushLanding.observe('/home');

    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    expect(mockCaptureMessage.mock.calls[0][0]).toContain('landed on Home');
    expect(pushLanding.current).toBeNull();
  });

  it('forgets the expectation once any other screen is reached', () => {
    pushLanding.expect('/messages/7', '/');
    pushLanding.observe('/thread');

    expect(pushLanding.current).toBeNull();
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });
});

describe('breadcrumbs', () => {
  beforeEach(() => jest.clearAllMocks());

  it('records a tap with only a link summary, never the id', () => {
    recordPushTap({ source: 'launch', type: 'new_message', link: '/messages/7' });

    expect(mockAddBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({
      category: 'push',
      message: 'tap',
      data: { source: 'launch', type: 'new_message', link: '/messages' },
    }));
  });

  it('records the redirect decision and the navigation result', () => {
    recordRedirectDecision({ action: 'deep-link', url: '/messages/7' }, '/');
    recordNavigationIssued('navigated', '/messages/7', '/');

    expect(mockAddBreadcrumb).toHaveBeenNthCalledWith(1, expect.objectContaining({
      message: 'redirect-decision',
      data: { action: 'deep-link', pathname: '/', target: '/messages' },
    }));
    expect(mockAddBreadcrumb).toHaveBeenNthCalledWith(2, expect.objectContaining({
      message: 'navigation-issued',
      data: { result: 'navigated', link: '/messages', from: '/' },
    }));
  });

  it('survives Sentry throwing', () => {
    mockAddBreadcrumb.mockImplementationOnce(() => { throw new Error('no client'); });
    expect(() => recordPushTap({ source: 'listener', type: 'event', link: null })).not.toThrow();
  });
});
