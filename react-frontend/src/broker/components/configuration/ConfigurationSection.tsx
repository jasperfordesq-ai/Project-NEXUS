// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * One settings section rendered from the schema: an icon-and-title card
 * with a row per setting. Rows render a Switch, a NumberField with its unit,
 * or an email Input; admin-only rows a broker cannot change carry the shared
 * "Admin only" chip and a disabled control.
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardBody, Input, NumberField, Separator, Switch } from '@/components/ui';
import type { BrokerConfig } from '@/admin/api/types';
import { AdminOnlyBadge } from '../AdminOnlyBadge';
import type { BrokerStatColor } from '../BrokerStatCard';
import { unitFormatOptions, type ConfigSectionDef, type ConfigSettingDef } from './configurationSchema';
import type { ConfigFormValues } from './configurationForm';

// Tailwind JIT needs full class names at build time.
const sectionTileClass: Record<BrokerStatColor, string> = {
  accent: 'text-accent bg-accent/10',
  success: 'text-success bg-success/10',
  warning: 'text-warning bg-warning/10',
  danger: 'text-danger bg-danger/10',
  neutral: 'text-muted bg-surface-tertiary',
};

interface SettingRowProps {
  label: string;
  help: string;
  /** Admin-only policy the current user cannot edit — renders the lock chip. */
  locked?: boolean;
  children: ReactNode;
}

function SettingRow({ label, help, locked = false, children }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-foreground">{label}</p>
          {locked && <AdminOnlyBadge />}
        </div>
        <p className="mt-0.5 text-sm leading-5 text-muted">{help}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Anchor id used by the page's section jump links. */
export function configSectionAnchor(sectionId: string): string {
  return `config-section-${sectionId}`;
}

interface ConfigurationSectionProps {
  section: ConfigSectionDef;
  form: ConfigFormValues;
  /** Whether the current user may change this key (admin, or not admin-only). */
  canEditKey: (key: keyof BrokerConfig) => boolean;
  onChange: <K extends keyof BrokerConfig>(key: K, value: ConfigFormValues[K]) => void;
}

export function ConfigurationSection({ section, form, canEditKey, onChange }: ConfigurationSectionProps) {
  const { t } = useTranslation('broker');
  const Icon = section.icon;

  const renderControl = (setting: ConfigSettingDef) => {
    const label = t(`configuration.field_${setting.key}_label`);
    const locked = !canEditKey(setting.key);
    const gated = setting.enabledWhen ? !form[setting.enabledWhen] : false;
    const disabled = locked || gated;

    if (setting.type === 'boolean') {
      return (
        <Switch
          aria-label={label}
          isSelected={Boolean(form[setting.key])}
          onValueChange={(v) => onChange(setting.key as BooleanKey, v)}
          isDisabled={disabled}
        />
      );
    }

    if (setting.type === 'email') {
      return (
        <Input
          type="email"
          aria-label={t(`configuration.field_${setting.key}_aria`)}
          value={String(form[setting.key] ?? '')}
          onValueChange={(v) => onChange(setting.key as StringKey, v)}
          placeholder={t(`configuration.field_${setting.key}_placeholder`)}
          className="w-48 sm:w-64"
          size="sm"
          isDisabled={disabled}
        />
      );
    }

    const raw = form[setting.key];
    // NaN is React Aria's "empty" — keeping '' in our state means a cleared
    // field stays cleared instead of snapping to a default.
    const value = typeof raw === 'number' ? raw : NaN;
    return (
      <NumberField
        aria-label={t(`configuration.field_${setting.key}_aria`)}
        value={value}
        onChange={(next) => onChange(setting.key as NumberKey, next === undefined || Number.isNaN(next) ? '' : next)}
        minValue={setting.min}
        maxValue={setting.max}
        step={setting.step}
        formatOptions={unitFormatOptions(setting.unit, setting.step)}
        isDisabled={disabled}
        className="w-40 sm:w-44"
      >
        <NumberField.Group>
          <NumberField.DecrementButton />
          <NumberField.Input className="tabular-nums" />
          <NumberField.IncrementButton />
        </NumberField.Group>
      </NumberField>
    );
  };

  return (
    <Card
      id={configSectionAnchor(section.id)}
      className="scroll-mt-24 rounded-2xl border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]"
    >
      <div className="flex items-start gap-3 p-4 sm:p-5">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-current/10 ${sectionTileClass[section.color]}`}
        >
          <Icon size={20} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            {t(`configuration.section_${section.id}`)}
          </h2>
          <p className="text-sm text-muted">{t(`configuration.section_${section.id}_desc`)}</p>
        </div>
      </div>
      <Separator />
      <CardBody className="divide-y divide-divider p-0">
        {section.settings.map((setting) => {
          if (setting.visibleWhen && !form[setting.visibleWhen]) return null;
          return (
            <SettingRow
              key={setting.key}
              label={t(`configuration.field_${setting.key}_label`)}
              help={t(`configuration.field_${setting.key}_help`)}
              locked={!canEditKey(setting.key)}
            >
              {renderControl(setting)}
            </SettingRow>
          );
        })}
      </CardBody>
    </Card>
  );
}

// Narrowed key families, so each control's onChange is typed to its value.
type BooleanKey = { [K in keyof BrokerConfig]: BrokerConfig[K] extends boolean ? K : never }[keyof BrokerConfig];
type NumberKey = { [K in keyof BrokerConfig]: BrokerConfig[K] extends number ? K : never }[keyof BrokerConfig];
type StringKey = { [K in keyof BrokerConfig]: BrokerConfig[K] extends string ? K : never }[keyof BrokerConfig];

export default ConfigurationSection;
