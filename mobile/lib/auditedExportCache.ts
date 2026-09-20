// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { AppState } from 'react-native';
import { Directory, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';

// A receiving app can keep reading after the native share promise settles. Keep
// its private source for one hour; expired files are removed only in foreground.
// After process death, the next active launch performs the same bounded cleanup.
const RETENTION_MS = 60 * 60 * 1000;
const PREFIX = 'nexus-audited-export-';
const ownedName = /^nexus-audited-export-(\d{13})-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const leased = new Set<string>();

export function createAuditedExportDirectory() {
  const directory = new Directory(Paths.cache, PREFIX + Date.now() + '-' + randomUUID());
  directory.create();
  leased.add(directory.uri);
  return {
    directory,
    release: () => { leased.delete(directory.uri); },
    dispose: () => {
      try { if (directory.exists) directory.delete(); }
      finally { leased.delete(directory.uri); }
    },
  };
}

/** Only this feature's exact, expired cache directories are eligible for deletion. */
export function cleanAuditedExportCache(): void {
  if (AppState.currentState !== 'active') return;
  let entries: ReturnType<Directory['list']>;
  try { entries = new Directory(Paths.cache).list(); } catch { return; }
  for (const entry of entries) {
    if (!(entry instanceof Directory) || leased.has(entry.uri)) continue;
    const name = entry.uri.replace(/\/$/, '').split('/').pop() ?? '';
    const match = ownedName.exec(name);
    if (!match || Date.now() - Number(match[1]) < RETENTION_MS) continue;
    try { entry.delete(); } catch { /* Retry on the next foreground cleanup. */ }
  }
}

export function observeAuditedExportCleanup(): () => void {
  cleanAuditedExportCache();
  const listener = AppState.addEventListener('change', state => { if (state === 'active') cleanAuditedExportCache(); });
  const timer = setInterval(cleanAuditedExportCache, 60000);
  return () => { listener.remove(); clearInterval(timer); };
}
