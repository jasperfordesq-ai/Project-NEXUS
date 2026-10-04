// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * System Configuration — the "additional configuration" sections of the admin
 * Settings page (localisation, onboarding, wallet, moderation, notifications,
 * limits). Presentational only: state, validation and saving live in
 * useSystemConfigForm so the page's single Save bar can save both halves.
 * Never routed standalone.
 */

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Info from 'lucide-react/icons/info';
import Lock from 'lucide-react/icons/lock';
import { Button, Chip, Input, Select, SelectItem, Switch, Textarea, Tooltip } from '@/components/ui';
import { useTenant } from '@/contexts';
import { SettingsSection, SettingsRow } from '../system/settings/SettingsSection';
import type { ConfigSettingDef } from './systemConfigSchema';
import type { SystemConfigFormState } from './useSystemConfigForm';

interface SystemConfigProps {
  form: SystemConfigFormState;
}

/** Section id for a config group — prefixed so it cannot collide with the main form's sections. */
export function systemConfigSectionId(groupKey: string): string {
  return `config-${groupKey}`;
}

export function SystemConfig({ form }: SystemConfigProps) {
  const { t } = useTranslation(['admin_enterprise', 'admin_system']);
  const { tenantPath } = useTenant();

  const lockedChip = (
    <Tooltip content={t('admin_system:system.super_admin_only_tooltip')}>
      <Chip size="sm" color="warning" variant="soft" startContent={<Lock size={10} aria-hidden="true" />}>
        {t('admin_system:system.super_admin_only')}
      </Chip>
    </Tooltip>
  );

  const helpWithTooltip = (def: ConfigSettingDef) => (
    <span className="inline-flex items-start gap-1.5">
      <span>{def.description}</span>
      <Tooltip content={def.description} delay={300}>
        <Info size={14} className="mt-0.5 shrink-0 cursor-help text-muted" aria-hidden="true" />
      </Tooltip>
    </span>
  );

  function renderControl(def: ConfigSettingDef) {
    const value = form.getValue(def.key, def.default);
    const error = form.errors[def.key];

    switch (def.type) {
      case 'boolean': {
        const readOnly = form.isReadOnly(def.key);
        return (
          <>
            {def.manage && (
              <Button
                as={Link}
                to={tenantPath(def.manage.href)}
                size="sm"
                variant="secondary"
                endContent={<ArrowRight size={14} aria-hidden="true" />}
              >
                {def.manage.label}
              </Button>
            )}
            <Switch
              isSelected={value === true}
              onValueChange={readOnly ? undefined : (v) => form.setValue(def.key, v, def)}
              isDisabled={readOnly}
              aria-label={def.label}
              size="sm"
            />
          </>
        );
      }

      case 'select':
        return (
          <Select
            selectedKeys={value ? [String(value)] : []}
            onSelectionChange={(keys) => {
              const selected = Array.from(keys)[0];
              if (selected !== undefined) form.setValue(def.key, String(selected), def);
            }}
            aria-label={def.label}
            variant="secondary"
            size="sm"
            className="w-full sm:w-56"
            isInvalid={!!error}
            errorMessage={error}
          >
            {(def.key === 'locale' ? form.localeOptions : (def.options ?? [])).map((opt) => (
              <SelectItem key={opt.value} id={opt.value}>{opt.label}</SelectItem>
            ))}
          </Select>
        );

      case 'textarea':
        return (
          <Textarea
            value={String(value)}
            onValueChange={(v) => form.setValue(def.key, v, def)}
            aria-label={def.label}
            variant="secondary"
            size="sm"
            minRows={2}
            maxRows={5}
            className="w-full sm:w-80"
            isInvalid={!!error}
            errorMessage={error}
          />
        );

      case 'number':
        return (
          <Input
            type="number"
            value={String(value ?? '')}
            onValueChange={(v) => form.setValue(def.key, v === '' ? (def.default ?? 0) : Number(v), def)}
            aria-label={def.label}
            variant="secondary"
            size="sm"
            className="w-32 tabular-nums"
            isInvalid={!!error}
            errorMessage={error}
            min={def.validation?.min}
            max={def.validation?.max}
          />
        );

      default:
        // text, email, url
        return (
          <Input
            type={def.type === 'email' ? 'email' : def.type === 'url' ? 'url' : 'text'}
            value={String(value)}
            onValueChange={(v) => form.setValue(def.key, v, def)}
            aria-label={def.label}
            variant="secondary"
            size="sm"
            className="w-full sm:w-72"
            isInvalid={!!error}
            errorMessage={error}
          />
        );
    }
  }

  return (
    <>
      {form.schema.map((group) => (
        <SettingsSection
          key={group.key}
          id={systemConfigSectionId(group.key)}
          icon={group.icon}
          title={group.label}
          description={group.description}
          layout="rows"
        >
          {group.settings.map((def) => (
            <SettingsRow
              key={def.key}
              label={def.label}
              help={helpWithTooltip(def)}
              badge={form.isTierLocked(def.key) ? lockedChip : undefined}
              muted={form.isReadOnly(def.key)}
            >
              {renderControl(def)}
            </SettingsRow>
          ))}
        </SettingsSection>
      ))}
    </>
  );
}

export default SystemConfig;
