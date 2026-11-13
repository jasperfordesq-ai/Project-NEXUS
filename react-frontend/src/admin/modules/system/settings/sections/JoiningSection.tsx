// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ArrowRight from 'lucide-react/icons/arrow-right';
import UserPlus from 'lucide-react/icons/user-plus';
import Lock from 'lucide-react/icons/lock';
import { Button, Chip, Input, Switch, Textarea, Tooltip } from '@/components/ui';
import { useAuth, useTenant } from '@/contexts';
import { isGodUser } from '@/lib/access';
import { InviteCodesPanel } from '../../InviteCodesPanel';
import { RegistrationBreakerCard } from '../../RegistrationBreakerCard';
import { SettingsSection, SettingsRow } from '../SettingsSection';
import { RegistrationModeField } from '../RegistrationModeField';
import { APPROVAL_EMAIL_MESSAGE_MAX_CHARS } from '../settingsForm';
import type { AdminSettingsFormState } from '../useAdminSettingsForm';

export const JOINING_SECTION_ID = 'joining';

/** Who can join, what a new member does first, and when people are signed out. */
export function JoiningSection({ state }: { state: AdminSettingsFormState }) {
  const { t } = useTranslation('admin_system');
  const { tenantPath } = useTenant();
  const { user } = useAuth();
  // Registration policy is god-only (owner, 13 Nov 2026); everyone else gets
  // what they need from it here: invite codes and resuming paused sign-ups.
  const isGod = isGodUser(user);
  const { form, setField, ctx } = state;
  // Email verification and member approval are platform-super-admin-only on
  // the server (F-054). Everyone else sees what is in force, but cannot change it.
  const canChangeGates = ctx.isGod;

  const platformTeamChip = (
    <Tooltip content={t('admin_settings.platform_team_only_tooltip')}>
      <Chip size="sm" color="warning" variant="soft" startContent={<Lock size={10} aria-hidden="true" />}>
        {t('admin_settings.platform_team_only')}
      </Chip>
    </Tooltip>
  );

  return (
    <SettingsSection
      id={JOINING_SECTION_ID}
      icon={<UserPlus size={20} aria-hidden="true" />}
      title={t('admin_settings.joining_section')}
      description={t('admin_settings.joining_section_desc')}
      layout="rows"
      actions={
        isGod ? (
          <Button
            as={Link}
            to={tenantPath('/admin/settings/registration-policy')}
            size="sm"
            variant="secondary"
            endContent={<ArrowRight size={14} aria-hidden="true" />}
          >
            {t('admin_settings.more_joining_rules')}
          </Button>
        ) : undefined
      }
    >
      <SettingsRow
        label={t('admin_settings.reg_mode_label')}
        help={t(isGod ? 'admin_settings.reg_mode_help' : 'admin_settings.reg_mode_help_codes')}
      >
        <RegistrationModeField value={form.registration_mode} onChange={(mode) => setField('registration_mode', mode)} />
      </SettingsRow>

      {/* The codes exist whatever the mode; they are only needed, so only
          shown, while Invite only is chosen. */}
      {form.registration_mode === 'invite_only' && (
        <div className="px-4 py-4 sm:px-5">
          <InviteCodesPanel />
        </div>
      )}

      <SettingsRow
        label={t('admin_settings.email_verification_label')}
        help={t('admin_settings.email_verification_help')}
        badge={!canChangeGates ? platformTeamChip : undefined}
      >
        <Switch
          isSelected={form.email_verification}
          onValueChange={(val) => setField('email_verification', val)}
          isDisabled={!canChangeGates}
          aria-label={t('admin_settings.email_verification_label')}
        />
      </SettingsRow>

      <SettingsRow
        label={t('admin_settings.admin_approval_label')}
        help={t('admin_settings.admin_approval_help')}
        badge={!canChangeGates ? platformTeamChip : undefined}
      >
        <Switch
          isSelected={form.admin_approval}
          onValueChange={(val) => setField('admin_approval', val)}
          isDisabled={!canChangeGates}
          aria-label={t('admin_settings.admin_approval_label')}
        />
      </SettingsRow>

      {/* Full width: a paragraph of text does not fit SettingsRow's control column. */}
      <div className="px-4 py-4 sm:px-5">
        <Textarea
          label={t('system.label_approval_email_message')}
          description={t('system.desc_approval_email_message')}
          placeholder={t('system.placeholder_approval_email_message')}
          variant="secondary"
          minRows={3}
          maxRows={10}
          maxLength={APPROVAL_EMAIL_MESSAGE_MAX_CHARS}
          value={form.approval_email_message}
          onValueChange={(val) => setField('approval_email_message', val)}
        />
        <p className="mt-1 text-right text-xs tabular-nums text-muted" aria-live="polite">
          {t('system.approval_email_message_count', {
            used: form.approval_email_message.length,
            max: APPROVAL_EMAIL_MESSAGE_MAX_CHARS,
          })}
        </p>
      </div>

      <SettingsRow label={t('admin_settings.auto_sign_out_label')} help={t('admin_settings.auto_sign_out_help')}>
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
          aria-label={t('admin_settings.auto_sign_out_aria')}
        />
        <span className="text-sm text-muted">{t('admin_settings.unit_minutes')}</span>
      </SettingsRow>

      {/* Sign-ups pause themselves after a burst of new accounts in an hour;
          a community admin can resume them here. */}
      <div className="px-4 py-4 sm:px-5">
        <RegistrationBreakerCard embedded />
      </div>

      {/* Maintenance mode is switched from the server, never from here. Only
          the platform's own administrators can act on that, so the row is
          shown to them alone: to a community admin it was a dead switch and a
          shell command. */}
      {ctx.isGod && (
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
      )}
    </SettingsSection>
  );
}

export default JoiningSection;
