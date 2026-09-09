// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { TENANT_PICKER_HREF, createTenantMismatchHandler } from './tenantMismatch';

function harness(isRepairInProgress: () => boolean = () => false) {
  const publish = jest.fn();
  const navigate = jest.fn();
  const handler = createTenantMismatchHandler({
    publish,
    navigate,
    t: (key: string) => key,
    isRepairInProgress,
  });
  return { handler, publish, navigate };
}

describe('a token that belongs to a different community', () => {
  /**
   * 🔴 Seen in the wild on 2026-09-09, release 1.4.0+7. The member's unread count,
   * notification count and push-device registration were all refused inside one second, so
   * they were signed in, receiving no notifications, and being told nothing. Retrying
   * cannot clear it: an account belongs to ONE community.
   */
  it('tells the member what happened and opens the community picker', () => {
    const { handler, publish, navigate } = harness();

    handler.onMismatch();

    expect(publish).toHaveBeenCalledWith({
      title: 'common:errors.wrongCommunityTitle',
      description: 'common:errors.wrongCommunityBody',
      variant: 'warning',
    });
    expect(navigate).toHaveBeenCalledWith(TENANT_PICKER_HREF);
  });

  /**
   * 🔴 The one that matters most. In this state EVERY request in flight fails the same
   * way — the observed launch had three refusals inside a second, and a busy one has many
   * more. Without the guard each would stack another copy of the picker.
   */
  it('acts once however many requests are refused', () => {
    const { handler, publish, navigate } = harness();

    for (let i = 0; i < 12; i += 1) handler.onMismatch();

    expect(publish).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('stays quiet while the member is still on the picker', () => {
    const { handler, navigate } = harness();

    handler.onMismatch();
    // A request that was already in flight when they arrived comes back refused.
    handler.onPathChange('/select-tenant');
    handler.onMismatch();

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('acts again on a mismatch that happens after they have left the picker', () => {
    const { handler, navigate } = harness();

    handler.onMismatch();
    handler.onPathChange('/select-tenant');
    handler.onPathChange('/home');
    handler.onMismatch();

    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('does nothing at all until a refusal actually arrives', () => {
    const { handler, publish, navigate } = harness();

    handler.onPathChange('/home');
    handler.onPathChange('/select-tenant');
    handler.onPathChange('/messages');

    expect(publish).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  /**
   * 🔴 The app repairs this by itself now, at sign-in and once per launch. At launch the two
   * race: the repair reads the cached profile while the first screens are already firing
   * requests that get refused. Without this the member would be told "choose your community
   * below" at the exact moment the app was choosing it for them.
   */
  it('says nothing while the app is already putting it right', () => {
    const { handler, publish, navigate } = harness(() => true);

    handler.onMismatch();

    expect(publish).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  /**
   * 🔴 The half that matters more. A repair can fail — the community list may be
   * unreachable, or the community itself may not load — and staying quiet after that would
   * leave the member with everything refused and nothing said. Keeping quiet must not
   * consume the once-only guard.
   */
  it('still apologises once the repair has given up', () => {
    let repairing = true;
    const { handler, publish, navigate } = harness(() => repairing);

    handler.onMismatch();
    repairing = false;
    handler.onMismatch();

    expect(publish).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(TENANT_PICKER_HREF);
  });

  /**
   * The href has to be the one the router knows. `decideAuthRedirect` sends a fresh install
   * to the same path, and it is deliberately exempt from the signed-in bounce to home —
   * which is the only reason a signed-in member can be left sitting on it.
   */
  it('sends them to the same picker route a fresh install uses', () => {
    expect(TENANT_PICKER_HREF).toBe('/(auth)/select-tenant');
  });
});
