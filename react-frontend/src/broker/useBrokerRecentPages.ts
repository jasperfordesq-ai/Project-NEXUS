// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * useBrokerRecentPages — the last few broker pages this browser visited.
 *
 * BrokerLayout records each `/broker/*` pathname (tenant slug stripped, the
 * dashboard excluded) in localStorage; the command palette lists them under
 * "Recent". Storage is per browser, never sent anywhere, and every access is
 * guarded so a blocked or corrupt store degrades to an empty list.
 */

import { useSyncExternalStore } from 'react';

export const BROKER_RECENT_STORAGE_KEY = 'nexus_broker_recent';
const LIMIT = 6;
const EMPTY: string[] = [];

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedList: string[] = EMPTY;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(BROKER_RECENT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): string[] {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** Current list, re-parsed only when the stored string changed (stable reference otherwise). */
function getSnapshot(): string[] {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedList = parse(raw);
  }
  return cachedList;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === BROKER_RECENT_STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * Strip the tenant slug and trailing slash; answer null for anything that is
 * not a broker page or is the dashboard itself.
 */
export function normaliseBrokerPath(pathname: string, tenantSlug?: string | null): string | null {
  let path = pathname;
  if (tenantSlug && path.startsWith(`/${tenantSlug}/`)) path = path.slice(tenantSlug.length + 1);
  else if (tenantSlug && path === `/${tenantSlug}`) path = '/';
  path = path.replace(/\/+$/, '');
  if (path === '/broker' || !path.startsWith('/broker/')) return null;
  return path;
}

/** Record a visit. Safe to call on every navigation. */
export function recordBrokerVisit(pathname: string, tenantSlug?: string | null): void {
  const path = normaliseBrokerPath(pathname, tenantSlug);
  if (!path) return;
  const next = [path, ...getSnapshot().filter((p) => p !== path)].slice(0, LIMIT);
  try {
    window.localStorage.setItem(BROKER_RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return;
  }
  for (const listener of listeners) listener();
}

/** The recently visited broker paths, newest first (max 6). */
export function useBrokerRecentPages(): string[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
