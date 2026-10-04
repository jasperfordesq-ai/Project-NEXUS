// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import UserCheck from 'lucide-react/icons/user-check';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Lock from 'lucide-react/icons/lock';
import { Button, Chip, Input, Switch, Tooltip } from '@/components/ui';
import { useTenant } from '@/contexts';
import { SettingsSection, SettingsRow } from '../SettingsSection';
import { RegistrationModeField } from '../RegistrationModeField';
import type { AdminSettingsFormState } from '../useAdminSettingsForm';

export const REGISTRATION_SECTION_ID = 'registration';

export function RegistrationSection({ state }: { state: AdminSettingsFormState }) {
  const { t } = useTranslation('admin_system');
  const { tenantPath } = useTenant();
  const { form, setField, ctx } = state;
  const isGod = ctx.isGod;

  const superAdminChip = (
    <Tooltip content={t('system.super_admin_only_tooltip')}>
      <Chip size="sm" color="warning" variant="soft" startContent={<Lock size={10} aria-hidden="true" />}>
        {t('system.super_admin_only')}
      </Chip>
    </Tooltip>
  );

  return (
    <SettingsSection
      id={REGISTRATION_SECTION_ID}
      icon={<UserCheck size={20} aria-hidden="true" />}
      title={t('system.section_registration_access')}
      description={t('admin_settings.section_registration_desc')}
      layout="rows"
      actions={
        <Button
          as={Link}
          to={tenantPath('/admin/settings/registration-policy')}
          size="sm"
          variant="secondary"
          startContent={<ShieldCheck size={14} aria-hidden="true" />}
        >
          {t('system.advanced_policy')}
        </Button>
      }
    >
      <SettingsRow label={t('admin_settings.reg_mode_label')} help={t('admin_settings.reg_mode_help')}>
        <RegistrationModeField value={form.registration_mode} onChange={(mode) => setField('registration_mode', mode)} />
      </SettingsRow>

      <SettingsRow
        label={t('system.require_email_verification')}
        help={t('system.desc_email_verification')}
        badge={!isGod ? superAdminChip : undefined}
      >
        <Switch
          isSelected={form.email_verification}
          onValueChange={(val) => setField('email_verification', val)}
          isDisabled={!isGod}
          aria-label={t('system.label_email_verification')}
        />
      </SettingsRow>

      <SettingsRow
        label={t('system.admin_approval_required')}
        help={t('system.admin_approval_required_desc')}
        badge={!isGod ? superAdminChip : undefined}
      >
        <Switch
          isSelected={form.admin_approval}
          onValueChange={(val) => setField('admin_approval', val)}
          isDisabled={!isGod}
          aria-label={t('system.label_admin_approval')}
        />
      </SettingsRow>

      <SettingsRow label={t('system.label_inactivity_timeout')} help={t('system.desc_inactivity_timeout')}>
        <Input
          type="number"
          min={0}
          max={480}
          step={5}
          size="sm"
          variant="secondary"
          className="w-28 tabular-nums"
          value={form.inactivity_timeout_minutes}
          onValueChange={(val) => setField('inactivity_timeout_minutes', val)}
          aria-label={t('system.label_inactivity_timeout')}
        />
      </SettingsRow>

      <SettingsRow
        label={t('system.maintenance_mode_read_only')}
        muted
        help={
          <>
            {t('system.maintenance_mode_cli_prefix')}{' '}
            {/* eslint-disable-next-line i18next/no-literal-string -- CLI command must remain verbatim. */}
            <code className="rounded bg-surface-secondary px-1 text-xs">sudo bash scripts/maintenance.sh on|off</code>
          </>
        }
      >
        <Switch isSelected={form.maintenance_mode} isDisabled aria-label={t('system.label_maintenance_mode')} />
      </SettingsRow>
    </SettingsSection>
  );
}

export default RegistrationSection;
