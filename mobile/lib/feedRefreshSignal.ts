// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "The feed I am holding is now out of date."
 *
 * 🔴 Why this exists. The home feed loads once and never re-reads on focus, which is the
 * right default for the app's busiest screen — a refetch on every tab switch costs a
 * request each time. But it means a member who writes a post and comes back to the feed
 * does not see it, and a post you cannot find reads as a post that was not saved.
 *
 * So writers mark the feed stale, and the feed re-reads on its next focus ONLY if the
 * marker moved. A plain module counter is enough: both sides run in the same JS context,
 * focus is the trigger, and nothing needs to be notified while it is not on screen.
 */

let version = 0;

/** Called after a write that a feed reader should see (a new post, a deletion). */
export function markFeedStale(): void {
  version += 1;
}

/** The current marker. A reader keeps its own copy and compares on focus. */
export function feedVersion(): number {
  return version;
}
