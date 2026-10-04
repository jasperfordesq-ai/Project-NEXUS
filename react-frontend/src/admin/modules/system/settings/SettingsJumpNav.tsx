// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Section jump links for the long Settings page. A pill per section; a small
 * amber dot marks sections with unsaved changes so the admin can see WHERE
 * the change is, not just that one exists.
 */

import { useTranslation } from 'react-i18next';
import { settingsSectionAnchor } from './SettingsSection';

export interface JumpNavSection {
  id: string;
  label: string;
  dirty?: boolean;
}

export function SettingsJumpNav({ sections }: { sections: JumpNavSection[] }) {
  const { t } = useTranslation('admin_system');
  return (
    <nav aria-label={t('admin_settings.jump_to_section')} className="flex flex-wrap gap-2">
      {sections.map((section) => (
        <a
          key={section.id}
          href={`#${settingsSectionAnchor(section.id)}`}
          data-dirty={section.dirty ? 'true' : undefined}
          aria-label={section.dirty ? t('admin_settings.section_dirty_aria', { section: section.label }) : undefined}
          className="inline-flex items-center gap-1.5 rounded-full border border-divider bg-surface px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-surface-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent data-[dirty=true]:border-warning/60"
        >
          {section.label}
          {section.dirty && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warning" />}
        </a>
      ))}
    </nav>
  );
}

export default SettingsJumpNav;
