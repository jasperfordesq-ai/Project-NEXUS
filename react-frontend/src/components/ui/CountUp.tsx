// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A number that counts up from zero when it first appears (warmth plan
 * Phase 4 A2). Screen readers get only the final number — the rolling digits
 * are hidden from them — and members who prefer reduced motion see the final
 * number at once.
 */

import { useCountUp } from '@/hooks/useCountUp';

interface CountUpProps {
  value: number;
  /** How to write the number (locale, suffix such as "K+"). Defaults to plain digits. */
  format?: (value: number) => string;
  decimals?: number;
  durationMs?: number;
}

export function CountUp({ value, format = String, decimals = 0, durationMs = 900 }: CountUpProps) {
  const shown = useCountUp(value, { fromZero: true, decimals, durationMs });
  return (
    <>
      <span aria-hidden="true">{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </>
  );
}

export default CountUp;
