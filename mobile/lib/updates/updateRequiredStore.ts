// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// ---------------------------------------------------------------------------
// UPDATE-REQUIRED STORE
//
// The client half of the force-update lever, and the half that CANNOT be
// retrofitted.
//
// 🔴 Why the ordering matters more than the code. A binary already installed on
// someone's phone can only be told "you must update" if that copy already knows
// how to ask and how to react. The server can refuse an old build all it likes;
// if the build has never heard of a 426 it will simply show the member a
// mysterious failure on every screen. So this must be present in the FIRST
// release. Ship one build without it and those copies can never be forced
// forward — a serious bug in them becomes permanent.
//
// How it works: `lib/api/client.ts` sends `X-Nexus-Mobile-Version` on every
// request. If the server answers 426 Upgrade Required, it calls `require()` here
// with what the server said, and `UpdateRequiredScreen` (rendered by the root
// layout) takes over the whole app.
//
// Deliberately a plain module store, not a context — the same lesson as
// `lib/notices/sessionNoticeStore.ts`. The API client is infrastructure: it has
// no provider above it, it is used by tests that render nothing, and it must
// never need a hook to report something. Infrastructure publishes; presentation
// subscribes.
//
// 🔴 One-way by design: there is no `clear()`. A build the server has refused
// does not become acceptable again while it is running, and offering a way out
// of the blocking screen would defeat the entire point. The only exit is
// installing a newer build — or a server-side change to the minimum, which takes
// effect on the next launch.
// ---------------------------------------------------------------------------

export interface UpdateRequirement {
  /** The version this copy is, as it told the server. */
  clientVersion: string;
  /** The lowest version the server will still talk to. */
  minimumVersion: string;
  /** The newest version available, for "update to X". */
  currentVersion: string;
  /**
   * Where to get it.
   *
   * 🔴 Comes from the SERVER, never hardcoded here. The copies that need this URL
   * most are precisely the ones that cannot be updated any other way, so the
   * destination has to be changeable without shipping a new binary.
   */
  updateUrl: string;
}

let requirement: UpdateRequirement | null = null;

const listeners = new Set<() => void>();

/** Trims a value the server sent, falling back to a safe empty string. */
function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const updateRequiredStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /**
   * Referentially stable between changes, as `useSyncExternalStore` requires —
   * returning a fresh object per call would loop for ever.
   */
  getSnapshot(): UpdateRequirement | null {
    return requirement;
  },

  /**
   * Record that the server has refused this build.
   *
   * Idempotent: repeated 426s (every in-flight request will get one) must not
   * cause a re-render storm, so a second call with the same values is a no-op.
   */
  require(next: UpdateRequirement): void {
    if (
      requirement !== null &&
      requirement.clientVersion === next.clientVersion &&
      requirement.minimumVersion === next.minimumVersion &&
      requirement.currentVersion === next.currentVersion &&
      requirement.updateUrl === next.updateUrl
    ) {
      return;
    }

    requirement = next;
    listeners.forEach((listener) => listener());
  },

  /**
   * Build a requirement from a 426 response body, tolerating anything missing.
   *
   * 🔴 Tolerant on purpose. This runs on the one response the app cannot afford to
   * mishandle: if a field is absent or the wrong type, the member must still get
   * the blocking screen with whatever is known, rather than an exception thrown
   * inside the API client while every screen fails for reasons it cannot explain.
   */
  fromResponseBody(body: unknown): UpdateRequirement {
    const source = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;

    return {
      clientVersion: str(source.client_version),
      minimumVersion: str(source.minimum_version),
      currentVersion: str(source.current_version),
      updateUrl: str(source.update_url),
    };
  },

  /** Test-only reset so suites don't leak a blocking state into one another. */
  __resetForTests(): void {
    requirement = null;
    listeners.clear();
  },
};
