// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Drive `useUnsavedChangesGuard` from a screen test.
 *
 * 🔴 Every create/edit form's test used to reach for the `beforeRemove` listener the guard
 * registered on `useNavigation()`. The guard now uses React Navigation's `usePreventRemove`
 * instead, because `beforeRemove` + `preventDefault()` is documented as not working
 * properly on a native stack — which is what Expo Router's `Stack` resolves to (audit
 * 2026-09-06, F08). These helpers read the mock jest-setup installs for that hook, so a
 * test asks the same two questions as before: is the screen protected, and what happens
 * when a removal is prevented.
 */

import type { usePreventRemove as UsePreventRemove } from '@react-navigation/native';

type PreventRemoveCall = [boolean, (options: { data: { action: unknown } }) => void];

function preventRemoveMock(): jest.MockedFunction<typeof UsePreventRemove> {
  const { usePreventRemove } = jest.requireMock('@react-navigation/native') as {
    usePreventRemove: jest.MockedFunction<typeof UsePreventRemove>;
  };
  return usePreventRemove;
}

/** What the guard last asked React Navigation to do, or `null` if it never rendered. */
function lastCall(): PreventRemoveCall | null {
  const calls = preventRemoveMock().mock.calls as unknown as PreventRemoveCall[];
  return calls.length > 0 ? calls[calls.length - 1] : null;
}

/** True when the screen is currently protected against being removed. */
export function isGuardArmed(): boolean {
  return lastCall()?.[0] === true;
}

/**
 * Replay what React Navigation does when it stops a protected screen being removed.
 * Returns the action the guard would replay if the member confirms.
 */
export function firePreventedRemoval(action: unknown = { type: 'GO_BACK' }): void {
  const call = lastCall();
  if (!call) throw new Error('useUnsavedChangesGuard has not rendered in this test.');
  call[1]({ data: { action } });
}
