// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Who can join: Open / Invite only / Closed. Replaces an on/off switch that
 * could not show an invite-only community correctly and downgraded it to
 * "closed" when toggled.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Globe from 'lucide-react/icons/globe';
import Mail from 'lucide-react/icons/mail';
import Lock from 'lucide-react/icons/lock';
import type { Key } from '@heroui/react/rac';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui';
import type { RegistrationMode } from './settingsForm';

export interface RegistrationModeFieldProps {
  value: RegistrationMode;
  onChange: (mode: RegistrationMode) => void;
}

const MODES: Array<{ id: RegistrationMode; labelKey: string; descKey: string; icon: typeof Globe }> = [
  { id: 'open', labelKey: 'admin_settings.reg_mode_open', descKey: 'admin_settings.reg_mode_open_desc', icon: Globe },
  { id: 'invite_only', labelKey: 'admin_settings.reg_mode_invite', descKey: 'admin_settings.reg_mode_invite_desc', icon: Mail },
  { id: 'closed', labelKey: 'admin_settings.reg_mode_closed', descKey: 'admin_settings.reg_mode_closed_desc', icon: Lock },
];

export function RegistrationModeField({ value, onChange }: RegistrationModeFieldProps) {
  const { t } = useTranslation('admin_system');
  const selectedKeys = useMemo(() => new Set<Key>([value]), [value]);
  const current = MODES.find((m) => m.id === value) ?? MODES[0]!;

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <ToggleButtonGroup
        aria-label={t('admin_settings.reg_mode_label')}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={selectedKeys}
        onSelectionChange={(keys) => {
          const [key] = Array.from(keys);
          if (key) onChange(key as RegistrationMode);
        }}
        size="sm"
      >
        {MODES.map(({ id, labelKey, icon: Icon }) => (
          <ToggleButton key={id} id={id}>
            <Icon size={14} aria-hidden="true" />
            <span>{t(labelKey)}</span>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <p className="max-w-sm text-xs leading-5 text-muted sm:text-right" aria-live="polite">
        {t(current.descKey)}
      </p>
    </div>
  );
}

export default RegistrationModeField;
