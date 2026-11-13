// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AppearanceSettings — Light/dark choice, accent color, font size, density, and
 * high contrast controls.
 *
 * Warmth plan D3 (11 Nov 2026): the light/dark choice lives here too (it was
 * only in the top bar's picker), each option drawn as a tiny page so members
 * can see what they are choosing, and a small sample card at the top shows
 * the current colour, text size and spacing as they change them.
 *
 * All changes apply immediately (live preview) and are persisted via ThemeContext
 * to both localStorage and the backend API.
 */

import { ButtonGroup } from '@/components/ui';
import Check from 'lucide-react/icons/check';
import { useTheme } from '@/contexts';
import { useTranslation } from 'react-i18next';
import type { FontSize, Density, ThemeMode } from '@/contexts/ThemeContext';
import { ACCENT_PRESETS, swatchFor } from '@/lib/accentPresets';
import Sun from 'lucide-react/icons/sun';
import Moon from 'lucide-react/icons/moon';
import Monitor from 'lucide-react/icons/monitor';
import { Button, Switch } from '@/components/ui';


// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function AppearanceSettings() {
  const { t } = useTranslation(['settings', 'common']);
  const {
    theme,
    setTheme,
    accentColor,
    communityAccent,
    fontSize,
    density,
    largeText,
    highContrast,
    reducedMotion,
    simplifiedLayout,
    setAccentColor,
    setFontSize,
    setDensity,
    setLargeText,
    setHighContrast,
    setReducedMotion,
    setSimplifiedLayout,
  } = useTheme();

  return (
    <div className="space-y-6">
      {/* ── Live preview ── */}
      <AppearancePreview />

      {/* ── Light / dark ── */}
      <div className="pt-4 border-t border-theme-default">
        <p id="appearance-scheme-label" className="text-sm font-medium text-theme-primary mb-1">
          {t('theme_picker.color_scheme', { ns: 'common' })}
        </p>
        <p className="text-xs text-theme-muted mb-3">
          {t('appearance_prefs.color_scheme_desc')}
        </p>
        <div role="radiogroup" aria-labelledby="appearance-scheme-label" className="grid grid-cols-3 gap-3">
          {SCHEMES.map(({ key, icon: Icon }) => {
            const isSelected = theme === key;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={isSelected}
                data-testid={`scheme-${key}`}
                onClick={() => { void setTheme(key); }}
                className={`group rounded-xl border-2 p-2 text-start transition-colors outline-solid outline-transparent focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2 ${
                  isSelected ? 'border-accent bg-accent-soft' : 'border-theme-default hover:border-accent/50'
                }`}
              >
                <SchemeThumbnail scheme={key} />
                <span className="mt-2 flex items-center gap-1.5 text-xs font-medium text-theme-primary">
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {t(`theme_picker.scheme_${key}`, { ns: 'common' })}
                  {isSelected && <Check className="ms-auto h-3.5 w-3.5 text-accent" aria-hidden="true" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Accent Color ── */}
      <div className="pt-4 border-t border-theme-default">
        <p className="text-sm font-medium text-theme-primary mb-1">
          {t('appearance_prefs.accent_color')}
        </p>
        <p className="text-xs text-theme-muted mb-3">
          {t('appearance_prefs.accent_color_desc')}
        </p>
        <div className="flex flex-wrap gap-2">
          {ACCENT_PRESETS.map((color) => {
            const isSelected = accentColor === color.hex;
            // The first swatch wears the community's colour where there is one
            // (a runtime colour, so it is painted by style, not a class).
            const { colour, followsCommunity } = swatchFor(color, communityAccent);
            return (
              <Button
                key={color.name}
                isIconOnly
                size="sm"
                aria-label={followsCommunity
                  ? t('appearance_prefs.select_community_color')
                  : t('appearance_prefs.select_color', { color: color.name })}
                className={[
                  'w-9 h-9 min-w-0 rounded-full border-2 border-transparent transition-transform',
                  followsCommunity ? 'ring-[var(--accent-color)]' : color.swatchClass,
                  isSelected ? 'scale-110 ring-2 ring-offset-2 ring-offset-[var(--background)]' : 'scale-100',
                ].join(' ')}
                style={followsCommunity ? { backgroundColor: colour } : undefined}
                onPress={() => setAccentColor(color.hex)}
              >
                {isSelected && (
                  <Check className="w-4 h-4 text-white drop-shadow-sm" aria-hidden="true" />
                )}
              </Button>
            );
          })}
        </div>
      </div>

      {/* ── Font Size ── */}
      <div className="pt-4 border-t border-theme-default">
        <p className="text-sm font-medium text-theme-primary mb-1">
          {t('appearance_prefs.font_size')}
        </p>
        <p className="text-xs text-theme-muted mb-3">
          {t('appearance_prefs.font_size_desc')}
        </p>
        <ButtonGroup>
          {(['small', 'medium', 'large'] as const).map((size) => (
            <Button
              key={size}
              size="sm"
              variant={fontSize === size ? 'solid' : 'flat'}
              className={fontSize === size ? 'bg-accent-strong text-white' : 'text-theme-secondary'}
              onPress={() => setFontSize(size as FontSize)}
            >
              {t(`appearance_prefs.font_${size}`)}
            </Button>
          ))}
        </ButtonGroup>
      </div>

      {/* ── Density ── */}
      <div className="pt-4 border-t border-theme-default">
        <p className="text-sm font-medium text-theme-primary mb-1">
          {t('appearance_prefs.density')}
        </p>
        <p className="text-xs text-theme-muted mb-3">
          {t('appearance_prefs.density_desc')}
        </p>
        <ButtonGroup>
          {(['compact', 'comfortable', 'spacious'] as const).map((d) => (
            <Button
              key={d}
              size="sm"
              variant={density === d ? 'solid' : 'flat'}
              className={density === d ? 'bg-accent-strong text-white' : 'text-theme-secondary'}
              onPress={() => setDensity(d as Density)}
            >
              {t(`appearance_prefs.density_${d}`)}
            </Button>
          ))}
        </ButtonGroup>
      </div>

      {/* ── High Contrast ── */}
      <div className="pt-4 border-t border-theme-default">
        <p className="text-sm font-medium text-theme-primary mb-1">
          {t('appearance_prefs.accessibility_profile')}
        </p>
        <p className="text-xs text-theme-muted mb-4">
          {t('appearance_prefs.accessibility_profile_desc')}
        </p>
        <div className="space-y-4">
          {[
            {
              key: 'large_text',
              selected: largeText,
              onChange: setLargeText,
            },
            {
              key: 'high_contrast',
              selected: highContrast,
              onChange: setHighContrast,
            },
            {
              key: 'reduced_motion',
              selected: reducedMotion,
              onChange: setReducedMotion,
            },
            {
              key: 'simplified_layout',
              selected: simplifiedLayout,
              onChange: setSimplifiedLayout,
            },
          ].map(({ key, selected, onChange }) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-theme-primary">
                  {t(`appearance_prefs.${key}`)}
                </p>
                <p className="text-xs text-theme-muted mt-0.5">
                  {t(`appearance_prefs.${key}_desc`)}
                </p>
              </div>
              <Switch
                isSelected={selected}
                onValueChange={onChange}
                aria-label={t(`appearance_prefs.${key}`)}
                size="sm"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const SCHEMES: Array<{ key: ThemeMode; icon: typeof Sun }> = [
  { key: 'light', icon: Sun },
  { key: 'dark', icon: Moon },
  { key: 'system', icon: Monitor },
];

/**
 * A tiny page in the given scheme: a bar in the community colour, a card and
 * two lines of text. Fixed light and dark shades on purpose, so each option
 * shows what it would look like whatever is chosen now. "System" is half of
 * each. Decoration only: the option's name is the label.
 */
function SchemeThumbnail({ scheme }: { scheme: ThemeMode }) {
  const page = (dark: boolean) => (
    <span className={`flex h-full flex-1 flex-col gap-1 p-1.5 ${dark ? 'bg-zinc-900' : 'bg-white'}`}>
      <span className="h-1.5 w-full rounded-full bg-accent" />
      <span className={`flex flex-1 flex-col gap-1 rounded-md p-1 ${dark ? 'bg-zinc-800' : 'bg-stone-100'}`}>
        <span className={`h-1 w-3/4 rounded-full ${dark ? 'bg-zinc-500' : 'bg-stone-400'}`} />
        <span className={`h-1 w-1/2 rounded-full ${dark ? 'bg-zinc-600' : 'bg-stone-300'}`} />
      </span>
    </span>
  );
  return (
    <span aria-hidden="true" className="flex h-16 overflow-hidden rounded-lg ring-1 ring-black/10 dark:ring-white/10">
      {scheme === 'light' && page(false)}
      {scheme === 'dark' && page(true)}
      {scheme === 'system' && (
        <>
          {page(false)}
          {page(true)}
        </>
      )}
    </span>
  );
}

/**
 * A small sample card that follows the member's choices as they make them:
 * it uses the site's own colour, text size and spacing, so changing a setting
 * below changes it at once. Purely a picture: nothing in it can be pressed.
 */
function AppearancePreview() {
  const { t } = useTranslation('settings');
  return (
    <section aria-labelledby="appearance-preview-label" data-testid="appearance-preview">
      <p id="appearance-preview-label" className="text-sm font-medium text-theme-primary mb-2">
        {t('appearance_prefs.preview')}
      </p>
      <div className="overflow-hidden rounded-2xl border border-theme-default bg-theme-elevated">
        <div className="h-2 bg-linear-to-r from-accent to-companion" aria-hidden="true" />
        <div className="space-y-2 p-4">
          <span className="inline-flex rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent-soft-foreground">
            {t('appearance_prefs.preview_label')}
          </span>
          <p className="text-base font-semibold text-theme-primary">{t('appearance_prefs.preview_title')}</p>
          <p className="text-sm text-theme-muted">{t('appearance_prefs.preview_body')}</p>
          <span aria-hidden="true" className="inline-flex rounded-lg bg-accent-strong px-3 py-1.5 text-sm font-semibold text-white">
            {t('appearance_prefs.preview_button')}
          </span>
        </div>
      </div>
    </section>
  );
}

export default AppearanceSettings;
