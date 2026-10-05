// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * How a volunteering safeguarding incident is filed: its kind, seriousness,
 * date, organisation and opportunity. Staff can correct what the reporter chose
 * or tie the incident to an organisation the reporter did not pick.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminVolunteering } from '../../../api/adminApi';
import { Autocomplete, AutocompleteItem, Button, Input, Select, SelectItem } from '@/components/ui';

export interface FilingValues {
  type: string;
  severity: string;
  date: string;
  organizationId: string;
  opportunityId: string;
}

/** What the incident is filed under now — kept selectable even if no longer listed. */
export interface FilingCurrent {
  organization_id?: number | null;
  organization_name?: string | null;
  opportunity_id?: number | null;
  opportunity_title?: string | null;
}

interface FilingOrganisation { id: number; name: string; }
interface FilingOpportunity { id: number; title: string; organization_id: number; organization_name: string; }

export const INCIDENT_TYPES = ['concern', 'allegation', 'disclosure', 'near_miss', 'other'] as const;
export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

/** Today in the browser's own calendar, for the date field's upper bound. */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function parsePayload<T>(raw: unknown): T {
  if (raw && typeof raw === 'object' && 'data' in raw) {
    return (raw as { data: T }).data;
  }
  return raw as T;
}

interface IncidentFilingFieldsProps {
  value: FilingValues;
  onChange: (next: FilingValues) => void;
  current: FilingCurrent;
  /** An error for the date field (client check or the server's answer). */
  dateError?: string | null;
}

export function IncidentFilingFields({ value, onChange, current, dateError }: IncidentFilingFieldsProps) {
  const { t } = useTranslation('admin_volunteering');
  const [organisations, setOrganisations] = useState<FilingOrganisation[]>([]);
  const [opportunities, setOpportunities] = useState<FilingOpportunity[]>([]);
  const [optionsState, setOptionsState] = useState<'loading' | 'ready' | 'failed'>('loading');

  const loadOptions = useCallback(async () => {
    setOptionsState('loading');
    try {
      const res = await adminVolunteering.getIncidentReportOptions();
      const payload = res?.success && res.data
        ? parsePayload<{ organisations?: FilingOrganisation[]; opportunities?: FilingOpportunity[] }>(res.data)
        : null;
      if (!payload) {
        setOptionsState('failed');
        return;
      }
      setOrganisations(payload.organisations || []);
      setOpportunities(payload.opportunities || []);
      setOptionsState('ready');
    } catch {
      setOptionsState('failed');
    }
  }, []);

  useEffect(() => { void loadOptions(); }, [loadOptions]);

  // An inactive or removed organisation is not in the community's list, but an
  // incident already filed under it must still show it.
  const organisationChoices: FilingOrganisation[] = (() => {
    const list = [...organisations];
    const currentId = current.organization_id;
    if (currentId && !list.some((o) => o.id === currentId)) {
      list.unshift({ id: currentId, name: current.organization_name || `#${currentId}` });
    }
    return list;
  })();
  const opportunityChoices: FilingOpportunity[] = (() => {
    const list = value.organizationId
      ? opportunities.filter((o) => String(o.organization_id) === value.organizationId)
      : opportunities;
    const currentId = current.opportunity_id;
    if (currentId && String(currentId) === value.opportunityId && !list.some((o) => o.id === currentId)) {
      return [{ id: currentId, title: current.opportunity_title || `#${currentId}`, organization_id: Number(value.organizationId) || 0, organization_name: '' }, ...list];
    }
    return list;
  })();

  const chooseOrganisation = (key: string | null) => {
    const keep = !!key && opportunities.some((o) => String(o.id) === value.opportunityId && String(o.organization_id) === key);
    onChange({ ...value, organizationId: key ?? '', opportunityId: keep ? value.opportunityId : '' });
  };
  const chooseOpportunity = (key: string | null) => {
    const chosen = key ? opportunities.find((o) => String(o.id) === key) : undefined;
    // Choosing an opportunity also files the incident under its organisation.
    onChange({ ...value, opportunityId: key ?? '', organizationId: chosen ? String(chosen.organization_id) : value.organizationId });
  };

  const currentOrg = current.organization_id ? String(current.organization_id) : '';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          label={t('volunteering.col_incident_type')}
          selectedKeys={[value.type]}
          onSelectionChange={(keys) => onChange({ ...value, type: (Array.from(keys)[0] as string) || value.type })}
        >
          {INCIDENT_TYPES.map((type) => (
            <SelectItem key={type} id={type}>{t(`volunteering.incident_type_${type}`)}</SelectItem>
          ))}
        </Select>
        <Select
          label={t('volunteering.col_severity')}
          selectedKeys={[value.severity]}
          onSelectionChange={(keys) => onChange({ ...value, severity: (Array.from(keys)[0] as string) || value.severity })}
        >
          {SEVERITIES.map((sev) => (
            <SelectItem key={sev} id={sev}>{t(`volunteering.severity_${sev}`)}</SelectItem>
          ))}
        </Select>
      </div>
      <Input
        type="date"
        label={t('volunteering.incident_date_label')}
        value={value.date}
        max={todayIso()}
        onValueChange={(v) => onChange({ ...value, date: v })}
        isInvalid={!!dateError}
        errorMessage={dateError ?? undefined}
      />
      {optionsState === 'failed' ? (
        <p className="text-sm text-warning" role="status">{t('volunteering.filing_options_unavailable')}</p>
      ) : (
        <>
          <Autocomplete
            label={t('volunteering.col_organization')}
            placeholder={t('volunteering.filing_no_organisation')}
            searchPlaceholder={t('volunteering.filing_search_organisations')}
            value={value.organizationId || null}
            onChange={(key) => chooseOrganisation(key && !Array.isArray(key) ? String(key) : null)}
            isDisabled={optionsState !== 'ready' && organisationChoices.length === 0}
          >
            {organisationChoices.map((org) => (
              <AutocompleteItem key={String(org.id)} id={String(org.id)} textValue={org.name}>{org.name}</AutocompleteItem>
            ))}
          </Autocomplete>
          {value.organizationId && (
            <Button size="sm" variant="tertiary" onPress={() => chooseOrganisation(null)}>
              {t('volunteering.filing_clear_organisation')}
            </Button>
          )}
          <Autocomplete
            label={t('volunteering.col_opportunity')}
            placeholder={t('volunteering.filing_no_opportunity')}
            searchPlaceholder={t('volunteering.filing_search_opportunities')}
            value={value.opportunityId || null}
            onChange={(key) => chooseOpportunity(key && !Array.isArray(key) ? String(key) : null)}
            isDisabled={opportunityChoices.length === 0}
          >
            {opportunityChoices.map((opp) => (
              <AutocompleteItem key={String(opp.id)} id={String(opp.id)} textValue={`${opp.title} ${opp.organization_name}`}>
                {value.organizationId || !opp.organization_name ? opp.title : `${opp.title} — ${opp.organization_name}`}
              </AutocompleteItem>
            ))}
          </Autocomplete>
          {value.organizationId && value.organizationId !== currentOrg && (
            <p className="text-xs text-muted" role="note">{t('volunteering.filing_org_notice')}</p>
          )}
        </>
      )}
    </div>
  );
}

export default IncidentFilingFields;
