// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * One row of the admin Settings page for a setting owned by
 * useSystemConfigForm: its name and help on the left, its control on the
 * right. Presentational only — state, validation and saving live in the hook.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ComboBox, ComboBoxItem, Input } from '@/components/ui';
import { SettingsRow } from '../system/settings/SettingsSection';
import type { SystemConfigFormState } from './useSystemConfigForm';

/**
 * Every time zone the browser knows, as IANA names. UTC and the saved value
 * are always offered, so a zone this browser does not list is still shown as
 * the current choice rather than as an empty box.
 */
function timeZoneNames(current: string): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
  let known: string[] = [];
  try {
    known = intl.supportedValuesOf?.('timeZone') ?? [];
  } catch {
    known = [];
  }
  return Array.from(new Set(['UTC', ...known, current].filter((zone) => zone !== '')));
}

/** "America/New_York" reads better as "America/New York"; the saved value keeps the underscore. */
const zoneLabel = (zone: string) => zone.replace(/_/g, ' ');

export function ConfigSettingRow({ form, settingKey }: { form: SystemConfigFormState; settingKey: string }) {
  const { t } = useTranslation('admin_enterprise');
  const def = form.settings.find((s) => s.key === settingKey);
  const value = form.getValue(settingKey);
  const error = form.errors[settingKey];

  const zones = useMemo(
    () => (def?.type === 'timezone' ? timeZoneNames(String(value ?? '')).map((id) => ({ id, label: zoneLabel(id) })) : []),
    [def?.type, value],
  );

  if (!def) return null;

  return (
    <SettingsRow label={def.label} help={def.description}>
      {def.type === 'timezone' ? (
        <ComboBox<{ id: string; label: string }>
          aria-label={def.label}
          className="w-full sm:w-64"
          placeholder={t('enterprise.config_timezone_search')}
          items={zones}
          selectedKey={String(value)}
          onSelectionChange={(key) => {
            if (key != null) form.setValue(settingKey, String(key));
          }}
          useDefaultFilter
        >
          {(zone) => (
            <ComboBoxItem id={zone.id} textValue={zone.label}>
              {zone.label}
            </ComboBoxItem>
          )}
        </ComboBox>
      ) : (
        <>
          <Input
            type="number"
            value={String(value ?? '')}
            onValueChange={(v) => form.setValue(settingKey, v === '' ? (def.default ?? 0) : Number(v))}
            aria-label={def.unit ? `${def.label} (${def.unit})` : def.label}
            variant="secondary"
            size="sm"
            className="w-28 tabular-nums"
            isInvalid={!!error}
            errorMessage={error}
            min={def.validation?.min}
            max={def.validation?.max}
          />
          {def.unit && <span className="text-sm text-muted">{def.unit}</span>}
        </>
      )}
    </SettingsRow>
  );
}

export default ConfigSettingRow;
