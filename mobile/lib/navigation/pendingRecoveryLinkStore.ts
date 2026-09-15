// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Carries a signed-out account-recovery link across first-run community selection.
 *
 * The root navigator owns incoming links, while the community picker owns the action
 * that finishes first-run setup. Keeping the one pending link outside either screen
 * prevents their navigation effects from racing and discarding the original destination.
 */
let pendingLink: string | null = null;

export const pendingRecoveryLinkStore = {
  remember(link: string): void {
    pendingLink = link;
  },

  consume(): string | null {
    const link = pendingLink;
    pendingLink = null;
    return link;
  },

  clear(): void {
    pendingLink = null;
  },
};
