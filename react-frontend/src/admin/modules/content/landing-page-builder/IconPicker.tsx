// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Icon picker for cards, highlights and steps: a Select that draws each icon
 * next to a readable name, with a "Standard icon" choice that hands the
 * decision back to the public page.
 */

import { useTranslation } from 'react-i18next';
import { Select, SelectItem } from '@/components/ui';
import type { LandingIconId } from '@/types/landing-page';
import { ICON_CHOICES } from './sectionMeta';

const STANDARD = '__standard__';

export function IconPicker({
  value,
  onChange,
  standardIconId,
}: {
  value?: LandingIconId;
  onChange: (val: LandingIconId | undefined) => void;
  /** The icon the public page would use for this item when none is chosen. */
  standardIconId?: LandingIconId;
}) {
  const { t } = useTranslation('admin_content');
  const StandardIcon = ICON_CHOICES.find((c) => c.id === standardIconId)?.icon;

  return (
    <Select
      label={t('content.landing_label_icon')}
      selectedKeys={[value ?? STANDARD]}
      onSelectionChange={(keys) => {
        if (keys === 'all') return;
        const selected = Array.from(keys)[0] as string | undefined;
        onChange(selected && selected !== STANDARD ? (selected as LandingIconId) : undefined);
      }}
      variant="secondary"
      size="sm"
    >
      <SelectItem
        key={STANDARD}
        id={STANDARD}
        textValue={t('content.landing_icon_standard')}
        startContent={StandardIcon ? <StandardIcon size={16} aria-hidden="true" /> : null}
      >
        {t('content.landing_icon_standard')}
      </SelectItem>
      {ICON_CHOICES.map(({ id, icon: Icon, nameKey }) => (
        <SelectItem
          key={id}
          id={id}
          textValue={t(nameKey)}
          startContent={<Icon size={16} aria-hidden="true" />}
        >
          {t(nameKey)}
        </SelectItem>
      ))}
    </Select>
  );
}
