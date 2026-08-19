// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Replaces the entire app with `UpdateRequiredScreen` once the server has refused this
 * build as too old.
 *
 * 🔴 It REPLACES rather than overlays, and that is the important decision. An overlay
 * leaves the app mounted underneath, still polling, still retrying, still collecting
 * 426s — and on Android a back press or a stray tap can find its way past an overlay.
 * Replacing the tree means the refused build genuinely stops working, which is the
 * intended behaviour: the API will refuse every request anyway, so anything still
 * running would only produce failures nobody can explain.
 *
 * Placed ABOVE TenantProvider, AuthProvider and even ErrorBoundary on purpose. A build
 * old enough to be refused may fail to resolve its tenant or restore its session at all
 * — the whole point is that the server is turning it away — so the message must not
 * depend on any of that having worked. Everything it needs comes from the 426 response
 * and a provider-free theme store.
 */

import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';

import UpdateRequiredScreen from './UpdateRequiredScreen';
import { updateRequiredStore } from '@/lib/updates/updateRequiredStore';

export default function UpdateRequiredGate({ children }: { children: ReactNode }) {
  const requirement = useSyncExternalStore(
    updateRequiredStore.subscribe,
    updateRequiredStore.getSnapshot,
    updateRequiredStore.getSnapshot
  );

  if (requirement) {
    return <UpdateRequiredScreen requirement={requirement} />;
  }

  return <>{children}</>;
}
