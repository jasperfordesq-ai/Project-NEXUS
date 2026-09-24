// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { getMember } from '@/lib/api/members';
import { displayName } from '@/lib/api/messages';

/**
 * The display name of a member as the SERVER describes them, or null until it
 * answers (and whenever it refuses — a private or departed member).
 *
 * F-198 (residue of F-118): the appreciations wall and the public collections
 * screen titled themselves from the link's `name` parameter, i.e. whatever the
 * author of a deep link typed ("Community Coordinator's appreciations" over a
 * stranger's wall). A screen must name a member only from what this returns.
 */
export function useServerMemberName(memberId: string | number | null | undefined): string | null {
  const id = Number(memberId);
  const validId = Number.isSafeInteger(id) && id > 0 ? id : 0;
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    setName(null);
    if (!validId) return undefined;
    let active = true;
    getMember(validId)
      .then((response) => {
        if (!active) return;
        const resolved = displayName(response?.data, '').trim();
        setName(resolved || null);
      })
      .catch(() => {
        // A refusal or network failure leaves the generic title in place.
      });
    return () => {
      active = false;
    };
  }, [validId]);

  return name;
}
