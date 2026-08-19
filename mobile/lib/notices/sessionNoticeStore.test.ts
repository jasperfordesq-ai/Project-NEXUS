// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The store that lets infrastructure say something without depending on presentation.
 *
 * The assertions worth having are the ones that make the original bug impossible: that
 * publishing needs no provider and no React, that a notice is delivered exactly once, and
 * that two identical sign-outs are still two notices.
 */

import { sessionNoticeStore } from './sessionNoticeStore';

describe('sessionNoticeStore', () => {
  beforeEach(() => {
    sessionNoticeStore.__resetForTests();
  });

  it('starts with nothing to say', () => {
    expect(sessionNoticeStore.getSnapshot()).toBeNull();
  });

  it('🔴 publishes with no provider and no React in sight', () => {
    // The whole point. AuthProvider calls this from a plain callback; if it needed a
    // provider we would be back to the crash that started all this.
    sessionNoticeStore.publish({ title: 'Signed out', variant: 'warning' });

    expect(sessionNoticeStore.getSnapshot()).toMatchObject({
      title: 'Signed out',
      variant: 'warning',
    });
  });

  it('notifies subscribers on publish', () => {
    const listener = jest.fn();
    sessionNoticeStore.subscribe(listener);

    sessionNoticeStore.publish({ title: 'Signed out' });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('returns a referentially stable snapshot between changes', () => {
    // useSyncExternalStore loops for ever if getSnapshot returns a fresh object each call.
    sessionNoticeStore.publish({ title: 'Signed out' });

    expect(sessionNoticeStore.getSnapshot()).toBe(sessionNoticeStore.getSnapshot());
  });

  it('🔴 gives two identical notices distinct identities', () => {
    // Being signed out twice with the same wording must show twice. Keyed on a counter
    // rather than a timestamp, because Date.now() can repeat inside one millisecond.
    sessionNoticeStore.publish({ title: 'Signed out' });
    const first = sessionNoticeStore.getSnapshot()!.id;
    sessionNoticeStore.consume();
    sessionNoticeStore.publish({ title: 'Signed out' });

    expect(sessionNoticeStore.getSnapshot()!.id).not.toBe(first);
  });

  it('holds only the latest notice, not a backlog', () => {
    // A member offline for a while should not return to a stack of stale warnings.
    sessionNoticeStore.publish({ title: 'First' });
    sessionNoticeStore.publish({ title: 'Second' });

    expect(sessionNoticeStore.getSnapshot()!.title).toBe('Second');
  });

  it('clears on consume, and notifies so the host re-renders', () => {
    sessionNoticeStore.publish({ title: 'Signed out' });
    const listener = jest.fn();
    sessionNoticeStore.subscribe(listener);

    sessionNoticeStore.consume();

    expect(sessionNoticeStore.getSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('consuming nothing is a no-op rather than a spurious notification', () => {
    const listener = jest.fn();
    sessionNoticeStore.subscribe(listener);

    sessionNoticeStore.consume();

    expect(listener).not.toHaveBeenCalled();
  });

  it('drops a notice when nothing is listening rather than throwing', () => {
    // The correct degradation: a missing toast must never take a screen down.
    expect(() => sessionNoticeStore.publish({ title: 'Signed out' })).not.toThrow();
  });

  it('unsubscribes cleanly', () => {
    const listener = jest.fn();
    const unsubscribe = sessionNoticeStore.subscribe(listener);

    unsubscribe();
    sessionNoticeStore.publish({ title: 'Signed out' });

    expect(listener).not.toHaveBeenCalled();
  });
});
