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
import { AA_NORMAL_TEXT_CONTRAST, getAccessibleForegroundColor, getContrastRatio } from '@/lib/colorContrast';
import { SettingsSection, settingsSectionAnchor } from '../SettingsSection';
import { ColorSettingField } from '../ColorSettingField';
import { isHexColor } from '../headerPreview';
import type { AdminSettingsFormState } from '../useAdminSettingsForm';

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

  return (
    <SettingsSection
      id={COMMUNITY_COLOUR_SECTION_ID}
      icon={<Paintbrush size={20} aria-hidden="true" />}
      title={t('admin_settings.community_colour_section')}
      description={t('admin_settings.community_colour_desc')}
    >
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

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">{t('admin_settings.community_colour_preview')}</p>
        {/* HeroUI controls read the theme's --accent variables, so scoping
            them to this box previews the colour on the real components. The
            values are the colour being edited, not styling. The two "soft"
            values repeat HeroUI's own light-theme formula: it derives them
            once at :root, so a box-level --accent alone would not reach them. */}
        <div
          data-testid="community-colour-preview"
          className="flex flex-wrap items-center gap-4 rounded-xl border border-divider bg-surface p-4"
          style={{
            '--accent': preview,
            '--accent-foreground': getAccessibleForegroundColor(preview),
            '--accent-soft': `color-mix(in oklab, ${preview} 15%, transparent)`,
            '--accent-soft-foreground': `color-mix(in oklab, ${preview} 70%, var(--foreground) 30%)`,
            '--focus': preview,
            '--link': preview,
          } as CSSProperties}
        >
          <Button variant="primary">{t('admin_settings.community_colour_preview_button')}</Button>
          <Chip color="accent" variant="soft">{t('admin_settings.community_colour_preview_chip')}</Chip>
          {/* Points back at this section: a preview link must not navigate away
              from a form with unsaved changes. */}
          <Link href={`#${settingsSectionAnchor(COMMUNITY_COLOUR_SECTION_ID)}`}>
            {t('admin_settings.community_colour_preview_link')}
          </Link>
        </div>
      </div>
    </SettingsSection>
  );
}

export default CommunityColourSection;
