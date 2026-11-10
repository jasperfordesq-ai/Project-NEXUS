// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import LayoutGrid from 'lucide-react/icons/layout-grid';
import { useTranslation } from 'react-i18next';
import type { Key } from '@heroui/react/rac';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { DynamicIcon, ICON_MAP } from '@/components/ui/DynamicIcon';
import { useMemo } from 'react';
import { useSiteAccent, useSitePalette } from '@/contexts/SiteAccentContext';
import { categoryListColours } from '@/lib/categoryListColours';
import { categoryColour, colourForSeed } from '@/lib/categoryColours';
import type { MarketplaceCategory } from '@/types/marketplace';
import { coverSeed } from '@/lib/coverSeeds';

interface CategoryChipsProps {
  categories: MarketplaceCategory[];
  activeId?: number;
  onSelect: (id: number | null) => void;
}

export function CategoryChips({ categories, activeId, onSelect }: CategoryChipsProps) {
  const { t } = useTranslation('marketplace');
  const selectedKey = activeId == null ? 'all' : String(activeId);
  const palette = useSitePalette();
  // The categories share the palette out in id order, so two never match by
  // chance (warmth plan W3).
  const siteAccent = useSiteAccent();
  const colours = useMemo(() => categoryListColours(categories, siteAccent), [categories, siteAccent]);

  const handleSelectionChange = (keys: Set<Key>) => {
    const nextKey = Array.from(keys)[0];
    if (nextKey === 'all' || nextKey == null) {
      onSelect(null);
      return;
    }
    onSelect(Number(nextKey));
  };

  return (
    <ToggleButtonGroup
      aria-label={t('categories.label')}
      className="flex flex-wrap gap-2"
      disallowEmptySelection
      isDetached
      selectedKeys={[selectedKey]}
      selectionMode="single"
      size="sm"
      onSelectionChange={handleSelectionChange}
    >
      <ToggleButton id="all">
        <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
        {t('categories.all')}
      </ToggleButton>

      {categories.map((category) => {
        // Each category has its own colour from the community palette, the
        // same on every visit (AWID: "clear categories"; were all one grey).
        const colour = colours.get(String(category.id))
          ?? colourForSeed(coverSeed.marketplaceCategory(category.slug || category.id), palette);
        const hasIcon = Boolean(category.icon && ICON_MAP[category.icon]);
        return (
          <ToggleButton
            key={category.id}
            id={String(category.id)}
          >
            <span
              aria-hidden="true"
              data-testid="category-chip-mark"
              data-colour={colour}
              className={hasIcon
                ? `inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${categoryColour(colour).band}`
                : `h-2.5 w-2.5 shrink-0 rounded-full ${categoryColour(colour).dot}`}
            >
              {/* `icon` is a Lucide icon name from the category seeder; unknown names render a dot. */}
              {hasIcon && <DynamicIcon name={category.icon!} className="w-3 h-3" />}
            </span>
            {category.name}
          </ToggleButton>
        );
      })}
    </ToggleButtonGroup>
  );
}

export default CategoryChips;
