// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { communityPausedStore } from './communityPausedStore';

describe('communityPausedStore', () => {
  beforeEach(() => communityPausedStore.__resetForTests());

  it('starts with no community paused', () => {
    expect(communityPausedStore.getSnapshot()).toBeNull();
  });

  it('remembers which community the server said is paused', () => {
    communityPausedStore.markPaused('hour-timebank');
    expect(communityPausedStore.getSnapshot()).toBe('hour-timebank');
  });

  /**
   * Every request in flight is refused the same way, so a busy screen reports the
   * pause many times in a second. Only the first may notify, or the screen re-renders
   * once per refusal.
   */
  it('notifies once however many refusals report the same community', () => {
    const listener = jest.fn();
    communityPausedStore.subscribe(listener);

    communityPausedStore.markPaused('hour-timebank');
    communityPausedStore.markPaused('hour-timebank');
    communityPausedStore.markPaused('hour-timebank');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores a blank community', () => {
    communityPausedStore.markPaused('  ');
    expect(communityPausedStore.getSnapshot()).toBeNull();
  });

  it('forgets a community once it is no longer paused', () => {
    const listener = jest.fn();
    communityPausedStore.markPaused('hour-timebank');
    communityPausedStore.subscribe(listener);

    communityPausedStore.clear('hour-timebank');

    expect(communityPausedStore.getSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not forget a pause recorded for a different community', () => {
    communityPausedStore.markPaused('hour-timebank');
    communityPausedStore.clear('another-community');
    expect(communityPausedStore.getSnapshot()).toBe('hour-timebank');
  });

  it('stops notifying a listener that unsubscribed', () => {
    const listener = jest.fn();
    const unsubscribe = communityPausedStore.subscribe(listener);
    unsubscribe();
    communityPausedStore.markPaused('hour-timebank');
    expect(listener).not.toHaveBeenCalled();
  });
});
