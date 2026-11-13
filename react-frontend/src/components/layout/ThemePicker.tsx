// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ThemePicker — Compact theme picker for the navbar utility bar.
 *
 * Surfaces three controls from ThemeContext in a single popover:
 *   - Color scheme (light / dark / system)
 *   - Accent color (preset swatches)
 *   - Layout density (compact / comfortable / spacious — acts as the radius/scaling axis)
 *
 * Built on the @heroui/react v3 primitives via the @/components/ui compat layer.
 * The full accessibility profile (large text, high contrast, reduced motion,
 * simplified layout) remains in /settings → Appearance for deeper customisation.
 */

import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';
import type { Density, ThemeMode } from '@/contexts/ThemeContext';
import { Button } from '@/components/ui/Button';
import { ButtonGroup } from '@/components/ui/ButtonGroup';
import { Popover, PopoverContent, PopoverHeading, PopoverTrigger } from '@/components/ui/Popover';
import Sun from 'lucide-react/icons/sun';
import Moon from 'lucide-react/icons/moon';
import Monitor from 'lucide-react/icons/monitor';
import Check from 'lucide-react/icons/check';
import { ACCENT_PRESETS, swatchFor } from '@/lib/accentPresets';

// ─────────────────────────────────────────────────────────────────────────────
// Presets
// ─────────────────────────────────────────────────────────────────────────────


const SCHEMES: Array<{ key: ThemeMode; icon: typeof Sun }> = [
  { key: 'light', icon: Sun },
  { key: 'dark', icon: Moon },
  { key: 'system', icon: Monitor },
];

const DENSITIES: Density[] = ['compact', 'comfortable', 'spacious'];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

interface ThemePickerProps {
  /** Visual size of the trigger button. Defaults to compact navbar size. */
  triggerSize?: 'sm' | 'md';
  /** Override the trigger className (e.g. for the mobile drawer row). */
  triggerClassName?: string;
  /** Popover placement. Defaults to "bottom-end" for desktop utility bar. */
  placement?: 'bottom' | 'bottom-end' | 'bottom-start' | 'top' | 'top-end' | 'top-start';
}

export function ThemePicker({
  triggerSize = 'sm',
  triggerClassName,
  placement = 'bottom-end',
}: ThemePickerProps) {
  const { t } = useTranslation(['common', 'settings']);
  const {
    theme,
    resolvedTheme,
    setTheme,
    accentColor,
    communityAccent,
    setAccentColor,
    density,
    setDensity,
  } = useTheme();

  const isCompact = triggerSize === 'sm';
  const TriggerIcon = theme === 'system' ? Monitor : theme === 'dark' ? Moon : Sun;
  const triggerIconClassName = `${isCompact ? 'w-4 h-4' : 'w-[18px] h-[18px]'} ${
    theme === 'light'
      ? 'text-amber-500 dark:text-amber-300'
      : theme === 'dark'
        ? 'text-accent'
        : resolvedTheme === 'dark'
          ? 'text-sky-300'
          : 'text-theme-primary'
  }`;

  return (
    <Popover placement={placement} offset={8}>
      <PopoverTrigger>
        <Button
          isIconOnly
          variant="light"
          size={triggerSize}
          aria-label={t('theme_picker.open_label', { ns: 'common' })}
          className={
            triggerClassName ??
            (isCompact
              ? 'text-theme-muted hover:text-theme-primary w-8 h-8 min-w-8 shrink-0'
              : 'text-theme-muted hover:text-theme-primary')
          }
        >
          <TriggerIcon className={triggerIconClassName} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] bg-surface-solid border border-theme-default rounded-2xl shadow-xl p-4">
        <div className="space-y-4">
          {/* Title */}
          <div>
            <PopoverHeading className="text-sm font-semibold text-theme-primary">
              {t('theme_picker.title', { ns: 'common' })}
            </PopoverHeading>
            <p className="text-xs text-theme-muted mt-0.5">
              {t('theme_picker.subtitle', { ns: 'common' })}
            </p>
          </div>

          {/* Color scheme */}
          <section>
            <p className="text-xs font-medium text-theme-secondary mb-2">
              {t('theme_picker.color_scheme', { ns: 'common' })}
            </p>
            <ButtonGroup className="w-full">
              {SCHEMES.map(({ key, icon: Icon }) => {
                const isSelected = theme === key;
                return (
                  <Button
                    key={key}
                    size="sm"
                    variant={isSelected ? 'solid' : 'flat'}
                    onPress={() => { void setTheme(key); }}
                    aria-pressed={isSelected}
                    aria-label={t(`theme_picker.scheme_${key}`, { ns: 'common' })}
                    className={`flex-1 gap-1 ${
                      isSelected ? 'bg-accent-strong text-white' : 'text-theme-secondary'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                    <span className="text-xs">
                      {t(`theme_picker.scheme_${key}`, { ns: 'common' })}
                    </span>
                  </Button>
                );
              })}
            </ButtonGroup>
          </section>

          {/* Accent color */}
          <section>
            <p className="text-xs font-medium text-theme-secondary mb-2">
              {t('appearance_prefs.accent_color', { ns: 'settings' })}
            </p>
            <div className="grid grid-cols-5 gap-2">
              {ACCENT_PRESETS.map((color) => {
                const isSelected = accentColor.toLowerCase() === color.hex.toLowerCase();
                // The first swatch wears the community's colour where there is one.
                const { colour, followsCommunity } = swatchFor(color, communityAccent);
                return (
                  <button
                    key={color.name}
                    type="button"
                    aria-label={followsCommunity
                      ? t('settings:appearance_prefs.select_community_color')
                      : t('settings:appearance_prefs.select_color', { color: color.name })}
                    aria-pressed={isSelected}
                    onClick={() => setAccentColor(color.hex)}
                    style={{ backgroundColor: colour }}
                    className={`
                      w-9 h-9 rounded-full flex items-center justify-center
                      transition-transform outline-solid outline-transparent
                      focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2
                      ${isSelected ? 'scale-110 ring-2 ring-offset-2 ring-offset-[var(--background)] ring-[var(--accent-color)]' : 'scale-100 hover:scale-105'}
                    `}
                  >
                    {isSelected && (
                      <Check className="w-4 h-4 text-white drop-shadow-sm" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Density / scaling */}
          <section>
            <p className="text-xs font-medium text-theme-secondary mb-2">
              {t('appearance_prefs.density', { ns: 'settings' })}
            </p>
            <ButtonGroup className="w-full">
              {DENSITIES.map((d) => {
                const isSelected = density === d;
                return (
                  <Button
                    key={d}
                    size="sm"
                    variant={isSelected ? 'solid' : 'flat'}
                    onPress={() => setDensity(d)}
                    aria-pressed={isSelected}
                    className={`flex-1 text-xs ${
                      isSelected ? 'bg-accent-strong text-white' : 'text-theme-secondary'
                    }`}
                  >
                    {t(`appearance_prefs.density_${d}`, { ns: 'settings' })}
                  </Button>
                );
              })}
            </ButtonGroup>
          </section>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default ThemePicker;
