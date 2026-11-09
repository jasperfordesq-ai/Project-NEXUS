// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * FeedModeToggle — toggle between "For You" (EdgeRank) and "Recent" (chronological) feed modes.
 */


import { useMemo } from 'react';

import Sparkles from 'lucide-react/icons/sparkles';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import Clock from 'lucide-react/icons/clock';
import { useTranslation } from 'react-i18next';
import type { Key } from '@heroui/react/rac';

interface FeedModeToggleProps {
  mode: 'ranking' | 'recent';
  onModeChange: (mode: 'ranking' | 'recent') => void;
}

export function FeedModeToggle({ mode, onModeChange }: FeedModeToggleProps) {
  const { t } = useTranslation('feed');
  const selectedKeys = useMemo(() => new Set<Key>([mode]), [mode]);

  const handleSelectionChange = (keys: Set<Key>) => {
    const [key] = Array.from(keys);
    if (key) {
      onModeChange(key as 'ranking' | 'recent');
    }
  };

  return (
    <ToggleButtonGroup
      aria-label={t('mode.label')}
      // HeroUI's own ToggleButton look: a selected button is a soft pill in the
      // accent colour, with its own padding and readable text colour. (The
      // padding was zeroed, so the pill hugged the icon and text — owner, 9 Nov.)
      // Buttons use px-2.5 on phones, where this shares one bar with the
      // sorting chip and the Filters button, and HeroUI's own px-3 from sm up.
      className="gap-1 p-0"
      selectedKeys={selectedKeys}
      onSelectionChange={handleSelectionChange}
      selectionMode="single"
      disallowEmptySelection
      isDetached
      size="sm"
    >
      <ToggleButton
        id="ranking"
        variant="ghost"
        className="h-8 px-2.5 sm:px-3 text-[var(--text-muted)] transition-colors duration-200 hover:text-accent data-[selected=true]:font-semibold data-[selected=true]:text-accent-soft-foreground"
      >
        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{t('mode.for_you')}</span>
      </ToggleButton>
      <ToggleButton
        id="recent"
        variant="ghost"
        className="h-8 px-2.5 sm:px-3 text-[var(--text-muted)] transition-colors duration-200 hover:text-accent data-[selected=true]:font-semibold data-[selected=true]:text-accent-soft-foreground"
      >
        <Clock className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{t('mode.recent')}</span>
      </ToggleButton>
    </ToggleButtonGroup>
  );
}

export default FeedModeToggle;
