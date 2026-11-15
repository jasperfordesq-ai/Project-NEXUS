// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin → Make it yours → "Light or dark to start with": how the member
 * website looks to someone who has not chosen for themselves
 * (tenants.configuration.default_theme, published as branding.default_theme).
 *
 * Only a starting point. A person's own choice — the picker at the top of the
 * page, or their settings — is kept in their browser and always wins
 * (ThemeContext). Light stays the default: the platform went light-first on
 * 11 Aug 2026 after a coordinator said dark is hard on older eyes, which is
 * why the dark choice says so.
 *
 * It saves with the colour choices (one call, the page's Save bar). The
 * accessible site has no dark theme and the phone app follows the phone, so
 * the note under the choices says this is for the website only.
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import Check from 'lucide-react/icons/check';
import Monitor from 'lucide-react/icons/monitor';
import Moon from 'lucide-react/icons/moon';
import Sun from 'lucide-react/icons/sun';
import SunMoon from 'lucide-react/icons/sun-moon';
import { Radio, RadioGroup } from '@/components/ui';
import {
  COMMUNITY_DEFAULT_THEMES,
  normaliseCommunityDefaultTheme,
  type CommunityDefaultTheme,
} from '@/lib/communityLooks';
import { SettingsSection, settingsSectionAnchor } from '../SettingsSection';
import type { AdminSettingsFormState } from '../useAdminSettingsForm';

export const DEFAULT_THEME_SECTION_ID = 'default-theme';

const THEME_ICON: Record<CommunityDefaultTheme, ReactNode> = {
  light: <Sun size={16} aria-hidden="true" />,
  dark: <Moon size={16} aria-hidden="true" />,
  system: <Monitor size={16} aria-hidden="true" />,
};

export interface DefaultThemeSectionProps {
  state: AdminSettingsFormState;
}

export function DefaultThemeSection({ state }: DefaultThemeSectionProps) {
  const { t } = useTranslation('admin_system');
  const { form, setField } = state;
  const chosen = normaliseCommunityDefaultTheme(form.default_theme);

  return (
    <SettingsSection
      id={DEFAULT_THEME_SECTION_ID}
      icon={<SunMoon size={20} aria-hidden="true" />}
      title={t('admin_settings.default_theme_title')}
      description={t('admin_settings.default_theme_desc')}
    >
      {/* HeroUI's radio group, as the Soft / Vivid choice: one tab stop, the
          arrow keys move the choice. Named by the section's own heading. */}
      <RadioGroup
        aria-labelledby={`${settingsSectionAnchor(DEFAULT_THEME_SECTION_ID)}-title`}
        value={chosen}
        onChange={(value) => setField('default_theme', normaliseCommunityDefaultTheme(value))}
        orientation="horizontal"
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      >
        {COMMUNITY_DEFAULT_THEMES.map((theme) => (
          <Radio
            key={theme}
            value={theme}
            data-testid={`default-theme-${theme}`}
            className="cursor-pointer rounded-xl border-2 border-divider bg-surface p-3 text-start transition-colors outline-solid outline-transparent hover:border-accent/50 data-[selected=true]:border-accent data-[focus-visible=true]:outline-2 data-[focus-visible=true]:outline-focus data-[focus-visible=true]:outline-offset-2"
          >
            {({ isSelected }) => (
              <span className="block">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <span className="text-muted">{THEME_ICON[theme]}</span>
                  {t(`admin_settings.default_theme_${theme}`)}
                  {isSelected && <Check className="ms-auto h-4 w-4 text-accent" aria-hidden="true" />}
                </span>
                <span className="mt-1 block text-xs text-muted">{t(`admin_settings.default_theme_${theme}_hint`)}</span>
              </span>
            )}
          </Radio>
        ))}
      </RadioGroup>
      <p className="text-xs leading-5 text-muted">{t('admin_settings.default_theme_note')}</p>
    </SettingsSection>
  );
}

export default DefaultThemeSection;
