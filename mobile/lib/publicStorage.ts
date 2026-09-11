// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as FileSystem from 'expo-file-system/legacy';

/** Public configuration/preferences only. Credentials and profiles stay encrypted. */
export function isPublicStorageKey(key: string): boolean {
  return key.startsWith('nexus_tenant_config_')
    || ['nexus_tenant_slug', 'nexus_language', 'nexus_theme_mode'].includes(key);
}

function file(key: string): string {
  if (!isPublicStorageKey(key) || !FileSystem.documentDirectory) throw new Error('Public storage unavailable');
  return `${FileSystem.documentDirectory}public-${encodeURIComponent(key)}.json`;
}

export const publicStorage = {
  async get(key: string): Promise<string | null> {
    const path = file(key);
    if (!(await FileSystem.getInfoAsync(path)).exists) return null;
    return FileSystem.readAsStringAsync(path);
  },
  async set(key: string, value: string): Promise<void> {
    await FileSystem.writeAsStringAsync(file(key), value);
  },
  async remove(key: string): Promise<void> {
    await FileSystem.deleteAsync(file(key), { idempotent: true });
  },
};
