// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
const listeners = new Set<() => void>();
export function refreshUgcPreferences() { listeners.forEach(listener => listener()); }
export function subscribeUgcPreferences(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
