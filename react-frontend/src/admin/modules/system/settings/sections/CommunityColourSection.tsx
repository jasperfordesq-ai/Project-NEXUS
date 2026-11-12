// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin → Settings → "Community colour": the one colour the member website
 * uses for buttons, links, tabs and highlights (tenants.configuration
 * .primary_color, published as branding.primary_color). Built only from HeroUI
 * parts: a ColorSwatchPicker of suggestions, the shared HeroUI ColorPicker
 * field for any brand colour, an Alert, and a preview made of real HeroUI
 * controls.
 */

import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import Paintbrush from 'lucide-react/icons/paintbrush';
import { Alert, Button, Chip, ColorSwatchPicker, Label, Link } from '@/components/ui';
import { AA_NORMAL_TEXT_CONTRAST, ensureContrast, getAccessibleForegroundColor, getContrastRatio } from '@/lib/colorContrast';
import { SettingsSection, settingsSectionAnchor } from '../SettingsSection';
import { ColorSettingField } from '../ColorSettingField';
import { isHexColor } from '../headerPreview';
import type { AdminSettingsFormState } from '../useAdminSettingsForm';
import Check from 'lucide-react/icons/check';
import { COLOUR_STRENGTHS, COMMUNITY_LOOKS, normaliseColourStrength, type CornerStyle } from '@/lib/communityLooks';

export const COMMUNITY_COLOUR_SECTION_ID = 'community-colour';

/** The website's colour when a community has not chosen one (ThemeContext default). */
export const STANDARD_ACCENT = '#6366f1';

/**
 * Suggested colours. Every one reads as text on white at 4.5:1 or better
 * (pinned by the section's test), so any of them can be saved.
 */
export const COMMUNITY_COLOUR_PRESETS = [
  '#a3195b', // raspberry
  '#be123c', // rose
  '#b3441e', // terracotta
  '#a16207', // amber
  '#15803d', // green
  '#0f766e', // teal
  '#1d4ed8', // blue
  '#4f46e5', // indigo
  '#6d28d9', // violet
  '#334155', // slate
] as const;

/**
 * Each look's picture: a band from its colour to its companion, written out
 * so Tailwind generates the classes (warmth plan D1).
 */
const LOOK_BAND: Record<string, string> = {
  harbour: 'from-[#1d4ed8] to-teal-500',
  meadow: 'from-[#15803d] to-amber-500',
  hearth: 'from-[#b3441e] to-amber-500',
  heather: 'from-[#6d28d9] to-pink-500',
  berry: 'from-[#a3195b] to-orange-500',
  slate: 'from-[#334155] to-sky-500',
};
const LOOK_BUTTON: Record<string, string> = {
  harbour: 'bg-[#1d4ed8]',
  meadow: 'bg-[#15803d]',
  hearth: 'bg-[#b3441e]',
  heather: 'bg-[#6d28d9]',
  berry: 'bg-[#a3195b]',
  slate: 'bg-[#334155]',
};
const CORNER_CLASS: Record<CornerStyle, string> = {
  soft: 'rounded-lg',
  round: 'rounded-2xl',
  square: 'rounded-sm',
};

/**
 * A ColorSwatchPicker value no suggestion matches, so no swatch shows as
 * selected while the community uses the standard colour or a custom one.
 */
const NO_SUGGESTION_SELECTED = '#ffffff';

/** True when a chosen colour cannot be read as text on a white page. */
export function communityColourTooLight(hex: string): boolean {
  if (!isHexColor(hex)) return false;
  const ratio = getContrastRatio(hex.startsWith('#') ? hex : `#${hex}`, '#ffffff');
  return ratio !== null && ratio < AA_NORMAL_TEXT_CONTRAST;
}

export function CommunityColourSection({ state }: { state: AdminSettingsFormState }) {
  const { t } = useTranslation('admin_system');
  const { form, setField } = state;

  const chosen = isHexColor(form.community_color) ? form.community_color.toLowerCase() : '';
  const tooLight = communityColourTooLight(chosen);
  const preview = chosen || STANDARD_ACCENT;
  const matchesSuggestion = (COMMUNITY_COLOUR_PRESETS as readonly string[]).includes(chosen);
  const chosenLook = form.community_look || '';
  const chosenStrength = normaliseColourStrength(form.colour_strength);
  // The shade that carries white text: the colour itself when white reads on
  // it at 4.5:1, else deepened towards black until it does (as ThemeContext).
  const previewStrong = ensureContrast(preview, '#ffffff', AA_NORMAL_TEXT_CONTRAST, '#000000');

  return (
    <SettingsSection
      id={COMMUNITY_COLOUR_SECTION_ID}
      icon={<Paintbrush size={20} aria-hidden="true" />}
      title={t('admin_settings.community_colour_section')}
      description={t('admin_settings.community_colour_desc')}
    >
      {/* Ready-made looks (warmth plan D1): colour, companion colour and
          corners chosen together. Choosing one fills in the colour below,
          which can still be changed; "No look" keeps the standard companion
          and corners. */}
      <div className="space-y-2">
        <Label id="community-look-label" className="text-sm font-medium text-foreground">
          {t('admin_settings.community_look_title')}
        </Label>
        <p className="text-xs leading-5 text-muted">{t('admin_settings.community_look_hint')}</p>
        <div role="radiogroup" aria-labelledby="community-look-label" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {COMMUNITY_LOOKS.map((look) => {
            const isSelected = chosenLook === look.id;
            return (
              <button
                key={look.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                data-testid={`community-look-${look.id}`}
                onClick={() => {
                  setField('community_color', look.colour);
                  setField('community_look', look.id);
                }}
                className={`rounded-xl border-2 bg-surface p-2 text-start transition-colors outline-solid outline-transparent focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2 ${
                  isSelected ? 'border-accent' : 'border-divider hover:border-accent/50'
                }`}
              >
                <span aria-hidden="true" className={`block h-10 rounded-lg bg-linear-to-r ${LOOK_BAND[look.id]}`} />
                <span aria-hidden="true" className="mt-2 flex items-center gap-2">
                  <span className={`inline-flex px-2 py-0.5 text-[11px] font-semibold text-white ${LOOK_BUTTON[look.id]} ${CORNER_CLASS[look.corners]}`}>
                    {t('admin_settings.community_colour_preview_button')}
                  </span>
                </span>
                <span className="mt-2 flex items-center gap-1 text-sm font-medium text-foreground">
                  {t(`admin_settings.community_look_${look.id}`)}
                  {isSelected && <Check className="ms-auto h-4 w-4 text-accent" aria-hidden="true" />}
                </span>
                <span className="block text-xs text-muted">{t(`admin_settings.community_look_corners_${look.corners}`)}</span>
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={chosenLook === ''}
            data-testid="community-look-none"
            onClick={() => setField('community_look', '')}
            className={`rounded-xl border-2 border-dashed bg-surface p-2 text-start transition-colors outline-solid outline-transparent focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2 ${
              chosenLook === '' ? 'border-accent' : 'border-divider hover:border-accent/50'
            }`}
          >
            <span className="flex items-center gap-1 text-sm font-medium text-foreground">
              {t('admin_settings.community_look_none')}
              {chosenLook === '' && <Check className="ms-auto h-4 w-4 text-accent" aria-hidden="true" />}
            </span>
            <span className="mt-1 block text-xs text-muted">{t('admin_settings.community_look_none_hint')}</span>
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <Label id="community-colour-suggestions-label" className="text-sm font-medium text-foreground">
          {t('admin_settings.community_colour_suggested')}
        </Label>
        <p className="text-xs leading-5 text-muted">{t('admin_settings.community_colour_suggested_hint')}</p>
        <ColorSwatchPicker
          aria-labelledby="community-colour-suggestions-label"
          size="lg"
          value={matchesSuggestion ? chosen : NO_SUGGESTION_SELECTED}
          onChange={(color) => setField('community_color', color.toString('hex').toLowerCase())}
        >
          {COMMUNITY_COLOUR_PRESETS.map((preset) => (
            <ColorSwatchPicker.Item key={preset} color={preset}>
              <ColorSwatchPicker.Swatch />
              <ColorSwatchPicker.Indicator />
            </ColorSwatchPicker.Item>
          ))}
        </ColorSwatchPicker>
      </div>

      <ColorSettingField
        id="community-colour"
        label={t('admin_settings.community_colour_custom_label')}
        hint={t('admin_settings.community_colour_custom_hint')}
        value={form.community_color}
        fallback={STANDARD_ACCENT}
        onChange={(hex) => setField('community_color', hex)}
      />

      {tooLight && (
        <Alert color="warning" title={t('admin_settings.community_colour_too_light')} />
      )}

      {/* How strongly the colour is worn (warmth phase 5). Soft is how every
          community looked before this choice existed; vivid fills page
          openings and picture tiles with the colour. The preview below shows
          a page opening in the strength chosen here. */}
      <div className="space-y-2">
        <Label id="colour-strength-label" className="text-sm font-medium text-foreground">
          {t('admin_settings.colour_strength_title')}
        </Label>
        <p className="text-xs leading-5 text-muted">{t('admin_settings.colour_strength_hint')}</p>
        <div role="radiogroup" aria-labelledby="colour-strength-label" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {COLOUR_STRENGTHS.map((strength) => {
            const isSelected = chosenStrength === strength;
            return (
              <button
                key={strength}
                type="button"
                role="radio"
                aria-checked={isSelected}
                data-testid={`colour-strength-${strength}`}
                onClick={() => setField('colour_strength', strength)}
                className={`rounded-xl border-2 bg-surface p-3 text-start transition-colors outline-solid outline-transparent focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2 ${
                  isSelected ? 'border-accent' : 'border-divider hover:border-accent/50'
                }`}
              >
                <span className="flex items-center gap-1 text-sm font-medium text-foreground">
                  {t(`admin_settings.colour_strength_${strength}`)}
                  {isSelected && <Check className="ms-auto h-4 w-4 text-accent" aria-hidden="true" />}
                </span>
                <span className="mt-1 block text-xs text-muted">{t(`admin_settings.colour_strength_${strength}_hint`)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">{t('admin_settings.community_colour_preview')}</p>
        {/* HeroUI controls read the theme's --accent variables, so scoping
            them to this box previews the colour on the real components. The
            values are the colour being edited, not styling. The two "soft"
            values repeat HeroUI's own light-theme formula: it derives them
            once at :root, so a box-level --accent alone would not reach them.
            `--accent-strong` is the button shade of the colour being edited
            (ThemeContext's own rule: deepened until white text reads on it). */}
        <div
          data-testid="community-colour-preview"
          className="space-y-4 rounded-xl border border-divider bg-surface p-4"
          style={{
            '--accent': preview,
            '--accent-foreground': getAccessibleForegroundColor(preview),
            '--accent-soft': `color-mix(in oklab, ${preview} 15%, transparent)`,
            '--accent-soft-foreground': `color-mix(in oklab, ${preview} 70%, var(--foreground) 30%)`,
            '--accent-strong': previewStrong,
            '--accent-strong-end': `color-mix(in srgb, ${previewStrong}, #000 22%)`,
            '--focus': preview,
            '--link': preview,
          } as CSSProperties}
        >
          {/* A page opening as members will see it: tinted when soft, filled
              with white text when vivid. Decorative sample; the words are the
              community's own name. */}
          <div
            data-testid="community-colour-preview-opening"
            className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${
              chosenStrength === 'vivid'
                ? 'bg-linear-to-br from-accent-strong to-accent-strong-end text-white'
                : 'bg-accent-soft text-foreground'
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-flex shrink-0 rounded-xl p-2 ${
                chosenStrength === 'vivid' ? 'bg-white text-accent-strong' : 'bg-accent/20 text-accent-soft-foreground'
              }`}
            >
              <Paintbrush size={18} />
            </span>
            <span className="min-w-0">
              <span className="block text-base font-bold leading-tight">{t('admin_settings.colour_strength_preview_title')}</span>
              <span className="block text-xs">{t('admin_settings.colour_strength_preview_text')}</span>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="primary">{t('admin_settings.community_colour_preview_button')}</Button>
            <Chip color="accent" variant="soft">{t('admin_settings.community_colour_preview_chip')}</Chip>
            {/* Points back at this section: a preview link must not navigate away
                from a form with unsaved changes. */}
            <Link href={`#${settingsSectionAnchor(COMMUNITY_COLOUR_SECTION_ID)}`}>
              {t('admin_settings.community_colour_preview_link')}
            </Link>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}

export default CommunityColourSection;
