// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The client half of the force-update lever.
 *
 * The assertions that matter are the ones that keep this working in the one situation it
 * exists for: an old build, talking to a server that has already decided to refuse it,
 * with no guarantee that the response is well formed.
 */

import { updateRequiredStore } from './updateRequiredStore';

const SERVER_426 = {
  success: false,
  error: { code: 'APP_UPDATE_REQUIRED', message: 'This version of the app is no longer supported.' },
  client_version: '1.1.0',
  minimum_version: '1.2.0',
  current_version: '1.3.0',
  update_url: 'https://mobile.project-nexus.ie',
};

describe('updateRequiredStore', () => {
  beforeEach(() => {
    updateRequiredStore.__resetForTests();
  });

  it('starts with nothing required', () => {
    expect(updateRequiredStore.getSnapshot()).toBeNull();
  });

  it('🔴 reads a real 426 body from the server', () => {
    // Shape pinned against App\Http\Middleware\EnforceMobileMinimumVersion. If the
    // server renames a field, this fails rather than silently showing a blank screen.
    updateRequiredStore.require(updateRequiredStore.fromResponseBody(SERVER_426));

    expect(updateRequiredStore.getSnapshot()).toEqual({
      clientVersion: '1.1.0',
      minimumVersion: '1.2.0',
      currentVersion: '1.3.0',
      updateUrl: 'https://mobile.project-nexus.ie',
    });
  });

  it('notifies subscribers so the gate re-renders', () => {
    const listener = jest.fn();
    updateRequiredStore.subscribe(listener);

    updateRequiredStore.require(updateRequiredStore.fromResponseBody(SERVER_426));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('returns a referentially stable snapshot between changes', () => {
    // useSyncExternalStore loops for ever otherwise.
    updateRequiredStore.require(updateRequiredStore.fromResponseBody(SERVER_426));

    expect(updateRequiredStore.getSnapshot()).toBe(updateRequiredStore.getSnapshot());
  });

  it('🔴 ignores a repeat of the same refusal', () => {
    // Every in-flight request gets its own 426. Without this the store would notify
    // once per request and the gate would re-render in a storm at the worst moment.
    const listener = jest.fn();
    updateRequiredStore.subscribe(listener);

    updateRequiredStore.require(updateRequiredStore.fromResponseBody(SERVER_426));
    updateRequiredStore.require(updateRequiredStore.fromResponseBody(SERVER_426));
    updateRequiredStore.require(updateRequiredStore.fromResponseBody(SERVER_426));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies again when the server changes its answer', () => {
    updateRequiredStore.require(updateRequiredStore.fromResponseBody(SERVER_426));
    const listener = jest.fn();
    updateRequiredStore.subscribe(listener);

    updateRequiredStore.require(
      updateRequiredStore.fromResponseBody({ ...SERVER_426, minimum_version: '2.0.0' })
    );

    expect(listener).toHaveBeenCalledTimes(1);
  });

  describe('a malformed refusal', () => {
    // 🔴 This runs on the one response the app cannot afford to mishandle. Throwing here
    // would leave the member with failures on every screen and no explanation at all —
    // strictly worse than a blocking screen with a field missing.

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'nope'],
      ['a number', 42],
      ['an empty object', {}],
      ['an array', []],
    ])('survives %s', (_label, body) => {
      expect(() => updateRequiredStore.fromResponseBody(body)).not.toThrow();
    });

    it('yields empty strings rather than undefined', () => {
      // The screen renders these; `undefined` would print "undefined" to a member, which
      // is exactly the defect the visual audit found on the achievements page.
      const requirement = updateRequiredStore.fromResponseBody({});

      expect(requirement).toEqual({
        clientVersion: '',
        minimumVersion: '',
        currentVersion: '',
        updateUrl: '',
      });
    });

    it('ignores a non-string url rather than trusting it', () => {
      const requirement = updateRequiredStore.fromResponseBody({ update_url: { evil: true } });

      expect(requirement.updateUrl).toBe('');
    });

    it('trims whitespace the server may have left', () => {
      const requirement = updateRequiredStore.fromResponseBody({
        update_url: '  https://mobile.project-nexus.ie  ',
      });

      expect(requirement.updateUrl).toBe('https://mobile.project-nexus.ie');
    });
  });

  it('🔴 offers no way to clear the requirement', () => {
    // One-way by design. A build the server has refused does not become acceptable
    // again while it is running, and an escape hatch would defeat the whole lever.
    expect((updateRequiredStore as unknown as Record<string, unknown>).clear).toBeUndefined();
    expect((updateRequiredStore as unknown as Record<string, unknown>).dismiss).toBeUndefined();
  });
});
