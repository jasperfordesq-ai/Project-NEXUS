// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AdminEmbedContext — tells shared admin modules they are being rendered
 * inside another panel (today: the broker panel), which already draws its
 * own page header.
 *
 * The broker panel reuses admin modules (safeguarding, moderation, reports)
 * unchanged so the two surfaces never drift apart. Those modules render an
 * admin PageHeader, which would duplicate the broker header above it. Until
 * October 2026 the duplicate was hidden with scoped CSS selectors keyed on
 * the PageHeader's DOM shape; the selector hid the header's whole content
 * row, so the Refresh / New-assignment buttons vanished for brokers and an
 * empty card was left behind on every embedded page. A context flag is
 * explicit and cannot drift with markup: when embedded, PageHeader renders
 * only its action buttons as a slim toolbar, or nothing at all when it has
 * none.
 */

import { createContext, useContext, type ReactNode } from 'react';

const AdminEmbedContext = createContext(false);

/** Wrap an admin module to render it inside another panel's own page frame. */
export function AdminEmbed({ children }: { children: ReactNode }) {
  return <AdminEmbedContext.Provider value={true}>{children}</AdminEmbedContext.Provider>;
}

/** True when the current admin module is embedded in another panel. */
export function useAdminEmbedded(): boolean {
  return useContext(AdminEmbedContext);
}
