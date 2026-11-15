// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The number on a broker page's tab: how many rows are behind it.
 *
 * Until Nov 2026 each list page showed these numbers twice — on a row of four
 * large tiles, and again on the tabs under them — which pushed the list
 * itself most of the way down a laptop screen. The tiles are gone; the tab
 * carries the count.
 *
 * `neutral` is a plain total and is shown whatever its value. `warning` and
 * `danger` are for lists that should fall to zero: nothing waiting shows no
 * number at all, because an amber or red "0" reads as work.
 */

import { Chip } from '@/components/ui';
import { getFormattingLocale } from '@/lib/helpers';

export type BrokerTabCountTone = 'neutral' | 'warning' | 'danger';

interface BrokerTabCountProps {
  /** null/undefined while the count is unknown or could not be read: nothing is drawn. */
  value: number | null | undefined;
  tone?: BrokerTabCountTone;
}

export function BrokerTabCount({ value, tone = 'neutral' }: BrokerTabCountProps) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (tone !== 'neutral' && value <= 0) return null;
  return (
    <Chip
      size="sm"
      variant="soft"
      color={tone === 'neutral' ? 'default' : tone}
      data-tone={tone}
      className="tabular-nums"
    >
      {value.toLocaleString(getFormattingLocale())}
    </Chip>
  );
}

export default BrokerTabCount;
