// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Chip } from '@/components/ui/StatusChip';
import { Ionicons } from '@/components/ui/Icon';
import { bandColours } from '@/lib/theme/itemColours';
import { useColourScheme } from '@/lib/theme/useItemColours';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface CategoryLabelProps {
  /** What the label says: the category's (or type's) name. */
  label: string;
  /** A colour name from `itemColours` — the category's own, as the website shows it. */
  colour: string;
  icon?: IoniconName;
  testID?: string;
}

/**
 * A category shown in its own colour (AWID feedback, Nov 2026: "clear
 * categories"), so offers in "Gardening" look alike and unlike "Lifts", on
 * every card and page, and as on the website. The colours are the website's
 * `band` set; every one clears WCAG AA in light and dark
 * (lib/theme/itemColours.contrast.test.ts).
 */
export default function CategoryLabel({ label, colour, icon, testID }: CategoryLabelProps) {
  const band = bandColours(colour, useColourScheme());
  return (
    <Chip size="sm" variant="soft" style={{ backgroundColor: band.background }} testID={testID}>
      {icon ? <Ionicons name={icon} size={12} color={band.text} /> : null}
      <Chip.Label style={{ color: band.text }}>{label}</Chip.Label>
    </Chip>
  );
}
