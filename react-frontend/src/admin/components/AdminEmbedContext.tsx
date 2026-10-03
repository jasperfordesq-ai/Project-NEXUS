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
 * explicit and cannot drift with markup.
 *
 * Since 3 October 2026 the context also carries what the broker shell needs
 * to make an embedded module *look* like a broker page without the admin
 * panel changing at all:
 *
 * - `actionsHost` — an element inside the broker page header. An embedded
 *   module's action buttons (Refresh, Settings, New assignment…) are portaled
 *   into it, so they sit in the page header like every native broker page
 *   and no half-empty toolbar card is left in the content area.
 * - `AdminEmbedAutoRefresh` — subscribes a module's reload to the broker
 *   panel's auto-refresh (after any admin write, on tab focus, on an
 *   interval) only when embedded. The admin panel keeps its explicit Refresh.
 *
 * The admin StatCard / EmptyState / PageHeader read `useAdminEmbed()` and
 * swap in the broker primitives when embedded; nothing is gated on a prop.
 */

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBrokerAutoRefresh } from '@/broker/useBrokerAutoRefresh';

export interface AdminEmbedState {
  /** True when the current admin module is rendered inside another panel. */
  embedded: boolean;
  /**
   * Element in the host panel's page header that receives the module's
   * action buttons. Null until the host has mounted it (or when the host
   * page does not provide one), in which case PageHeader falls back to a
   * slim toolbar row of its own.
   */
  actionsHost: HTMLElement | null;
}

const NOT_EMBEDDED: AdminEmbedState = { embedded: false, actionsHost: null };

const AdminEmbedContext = createContext<AdminEmbedState>(NOT_EMBEDDED);

interface AdminEmbedProps {
  children: ReactNode;
  /** See `AdminEmbedState.actionsHost`. Wrapper pages get one from `useAdminEmbedActionsHost()`. */
  actionsHost?: HTMLElement | null;
}

/** Wrap an admin module to render it inside another panel's own page frame. */
export function AdminEmbed({ children, actionsHost = null }: AdminEmbedProps) {
  // A fresh object per render is fine: the only consumers re-render with the
  // provider anyway (host element changes once, on mount).
  return <AdminEmbedContext.Provider value={{ embedded: true, actionsHost }}>{children}</AdminEmbedContext.Provider>;
}

/** Everything the embedding host told us. Outside a provider: not embedded. */
export function useAdminEmbed(): AdminEmbedState {
  return useContext(AdminEmbedContext);
}

/** True when the current admin module is embedded in another panel. */
export function useAdminEmbedded(): boolean {
  return useContext(AdminEmbedContext).embedded;
}

/**
 * For the wrapper page: the element an embedded module's actions render into,
 * plus the slot that places it in the page header. The element is created
 * once, up front, rather than captured from a ref, so the embed has its host
 * on the very first render and the module does not render twice.
 *
 *   const { actionsHost, actionsSlot } = useAdminEmbedActionsHost();
 *   <BrokerPageShell actions={actionsSlot}>
 *     <AdminEmbed actionsHost={actionsHost}>…</AdminEmbed>
 *
 * Both the host and the slot are `display: contents`, so the module's
 * buttons lay out as direct children of the header's actions row.
 */
export function useAdminEmbedActionsHost(): { actionsHost: HTMLElement; actionsSlot: ReactNode } {
  const [actionsHost] = useState(() => {
    const el = document.createElement('div');
    el.className = 'contents';
    return el;
  });
  const attach = useCallback(
    (slot: HTMLDivElement | null) => {
      if (slot && actionsHost.parentElement !== slot) slot.appendChild(actionsHost);
    },
    [actionsHost],
  );
  return { actionsHost, actionsSlot: <div ref={attach} className="contents" /> };
}

interface AdminEmbedActionsProps {
  children: ReactNode;
  /** What to render when there is no host to portal into (admin panel, or host not mounted yet). */
  fallback: ReactNode;
}

/**
 * Puts a module's action buttons in the host panel's page header when there
 * is one, otherwise renders `fallback` in place. PageHeader uses it for its
 * `actions`; modules without a PageHeader (SupportActionsPanel) use it for
 * their lone Refresh button.
 */
export function AdminEmbedActions({ children, fallback }: AdminEmbedActionsProps) {
  const { actionsHost } = useAdminEmbed();
  if (actionsHost) return createPortal(children, actionsHost);
  return <>{fallback}</>;
}

function BrokerAutoRefresh({ reload }: { reload: () => void }) {
  useBrokerAutoRefresh(reload);
  return null;
}

/**
 * Keeps an embedded module current the way native broker pages are: `reload`
 * runs after any admin write anywhere on the page, when the tab becomes
 * visible again, and once a minute while it is. Pass a *quiet* reload — one
 * that keeps the current page and filters and does not switch the list back
 * to its loading state — or the table flashes every minute.
 *
 * Renders nothing, and subscribes nothing, in the admin panel.
 */
export function AdminEmbedAutoRefresh({ reload }: { reload: () => void }) {
  const { embedded } = useAdminEmbed();
  return embedded ? <BrokerAutoRefresh reload={reload} /> : null;
}
