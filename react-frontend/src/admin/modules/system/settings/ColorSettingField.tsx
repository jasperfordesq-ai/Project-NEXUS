// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A nullable hex colour setting: HeroUI ColorPicker (swatch trigger, area,
 * hue slider) plus a plain hex text field for pasting, and "Use default" to
 * clear the override. Empty string in form state means "no override"; the
 * picker is shown the fallback colour in that case.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ColorArea } from '@heroui/react/color-area';
import { ColorSlider } from '@heroui/react/color-slider';
import { ColorSwatch } from '@heroui/react/color-swatch';
import { parseColor, type Color } from '@heroui/react/rac';
import { Button, ColorPicker, Input } from '@/components/ui';
import { isHexColor } from './headerPreview';

export interface ColorSettingFieldProps {
  id: string;
  label: string;
  hint?: string;
  /** '' = no override. */
  value: string;
  /** Colour shown while there is no override. */
  fallback: string;
  onChange: (hex: string) => void;
}

function safeParse(hex: string, fallback: string): Color {
  try {
    return parseColor(isHexColor(hex) ? (hex.startsWith('#') ? hex : `#${hex}`) : fallback);
  } catch {
    return parseColor(fallback);
  }
}

export function ColorSettingField({ id, label, hint, value, fallback, onChange }: ColorSettingFieldProps) {
  const { t } = useTranslation('admin_system');
  // What the admin is typing, which may be a partial hex; committed to the
  // form only once it is a full six-digit colour.
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const effective = value || fallback;
  const color = safeParse(effective, fallback);

  const commitDraft = (next: string) => {
    setDraft(next);
    const trimmed = next.trim();
    if (trimmed === '') {
      onChange('');
    } else if (isHexColor(trimmed)) {
      onChange((trimmed.startsWith('#') ? trimmed : `#${trimmed}`).toLowerCase());
    }
  };

  return (
    <div className="space-y-2" data-testid={`color-field-${id}`}>
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {hint && <p className="mt-0.5 text-xs leading-5 text-muted">{hint}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <ColorPicker value={color} onChange={(c) => onChange(c.toString('hex').toLowerCase())}>
          <ColorPicker.Trigger aria-label={label} className="flex items-center gap-2">
            <ColorSwatch size="lg" className="h-10 w-10 rounded-lg border border-divider" />
            <span className="font-mono text-sm uppercase text-muted">{effective}</span>
          </ColorPicker.Trigger>
          <ColorPicker.Popover className="gap-2">
            <ColorArea aria-label={label} className="max-w-full" colorSpace="hsb" xChannel="saturation" yChannel="brightness">
              <ColorArea.Thumb />
            </ColorArea>
            <ColorSlider channel="hue" className="gap-1 px-1" colorSpace="hsb" aria-label={t('admin_settings.colour_hex_label')}>
              <ColorSlider.Track>
                <ColorSlider.Thumb />
              </ColorSlider.Track>
            </ColorSlider>
          </ColorPicker.Popover>
        </ColorPicker>
        <Input
          aria-label={`${label} — ${t('admin_settings.colour_hex_label')}`}
          variant="secondary"
          size="sm"
          className="w-36 font-mono"
          placeholder={fallback}
          value={draft}
          onValueChange={commitDraft}
          isInvalid={draft.trim() !== '' && !isHexColor(draft)}
        />
        {value && (
          <Button variant="tertiary" size="sm" onPress={() => onChange('')}>
            {t('admin_settings.use_default_colour')}
          </Button>
        )}
      </div>
    </div>
  );
}

export default ColorSettingField;
