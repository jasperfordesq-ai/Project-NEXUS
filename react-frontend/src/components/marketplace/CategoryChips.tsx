// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import LayoutGrid from 'lucide-react/icons/layout-grid';
import { useTranslation } from 'react-i18next';
import type { Key } from '@heroui/react/rac';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { DynamicIcon, ICON_MAP } from '@/components/ui/DynamicIcon';
import type { MarketplaceCategory } from '@/types/marketplace';

interface CategoryChipsProps {
  categories: MarketplaceCategory[];
  activeId?: number;
  onSelect: (id: number | null) => void;
}

export function CategoryChips({ categories, activeId, onSelect }: CategoryChipsProps) {
  const { t } = useTranslation('marketplace');
  const selectedKey = activeId == null ? 'all' : String(activeId);

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

      {categories.map((category) => (
        <ToggleButton
          key={category.id}
          id={String(category.id)}
        >
          {/* `icon` is a Lucide icon name from the category seeder; unknown names render no icon. */}
          {category.icon && ICON_MAP[category.icon] && (
            <DynamicIcon name={category.icon} className="w-3.5 h-3.5" />
          )}
          {category.name}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

export default CategoryChips;
