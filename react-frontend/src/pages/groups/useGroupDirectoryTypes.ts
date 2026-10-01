// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { logError } from '@/lib/logger';
import { listGroupDirectoryTypes, type GroupDirectoryType } from './api/directory';

/**
 * Active group types for the Groups directory filter.
 *
 * Empty until loaded, when the community defines no active types, or when the
 * request fails — the filter is optional, so the page simply hides it rather
 * than showing an error over the group list.
 */
export function useGroupDirectoryTypes(enabled: boolean): GroupDirectoryType[] {
  const [types, setTypes] = useState<GroupDirectoryType[]>([]);

  useEffect(() => {
    if (!enabled) {
      setTypes([]);
      return undefined;
    }
    const controller = new AbortController();
    listGroupDirectoryTypes({ signal: controller.signal })
      .then((rows) => {
        if (!controller.signal.aborted) setTypes(rows);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) logError('Failed to load group types', error);
      });
    return () => controller.abort();
  }, [enabled]);

  return types;
}
