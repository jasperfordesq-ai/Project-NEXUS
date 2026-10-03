// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Shared vocabulary for the Insurance Certificates page and its modals:
 * type keys, the form shape the create and edit modals both fill, date
 * conversion for the DatePicker, tenant-currency formatting and the one
 * page-fetch helper the list and the CSV export both page through.
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { parseDate, type DateValue } from '@internationalized/date';
import { useTenant } from '@/contexts';
import { formatCurrency, getFormattingLocale } from '@/lib/helpers';
import { adminInsurance } from '@/admin/api/adminApi';
import type { InsuranceCertificate } from '@/admin/api/types';
import type { CsvPage } from '@/broker/useCsvExport';

export const INSURANCE_TYPE_KEYS = [
  'public_liability',
  'professional_indemnity',
  'employers_liability',
  'product_liability',
  'personal_accident',
  'other',
] as const;

export type InsuranceTypeKey = (typeof INSURANCE_TYPE_KEYS)[number];

export const INSURANCE_TYPE_LABEL_KEYS: Record<InsuranceTypeKey, string> = {
  public_liability: 'insurance.type_public_liability',
  professional_indemnity: 'insurance.type_professional_indemnity',
  employers_liability: 'insurance.type_employers_liability',
  product_liability: 'insurance.type_product_liability',
  personal_accident: 'insurance.type_personal_accident',
  other: 'insurance.type_other',
};

/** The one form both the create and the edit modal fill. */
export interface InsuranceFormValues {
  user_id: string;
  insurance_type: InsuranceCertificate['insurance_type'];
  provider_name: string;
  policy_number: string;
  coverage_amount: string;
  /** ISO date (YYYY-MM-DD) or ''. */
  start_date: string;
  expiry_date: string;
  notes: string;
}

export const EMPTY_INSURANCE_FORM: InsuranceFormValues = {
  user_id: '',
  insurance_type: 'public_liability',
  provider_name: '',
  policy_number: '',
  coverage_amount: '',
  start_date: '',
  expiry_date: '',
  notes: '',
};

/** Pre-fill the form from an existing certificate (edit). */
export function insuranceFormFromCertificate(item: InsuranceCertificate): InsuranceFormValues {
  return {
    user_id: String(item.user_id),
    insurance_type: item.insurance_type,
    provider_name: item.provider_name || '',
    policy_number: item.policy_number || '',
    coverage_amount: item.coverage_amount ? String(item.coverage_amount) : '',
    start_date: isoDateOnly(item.start_date),
    expiry_date: isoDateOnly(item.expiry_date),
    notes: item.notes || '',
  };
}

/** `2025-01-01T00:00:00Z` → `2025-01-01`; anything unparseable → ''. */
export function isoDateOnly(value: string | null | undefined): string {
  if (!value) return '';
  const head = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : '';
}

/** DatePicker value for an ISO date string; null when empty or malformed. */
export function toDateValue(value: string | null | undefined): DateValue | null {
  const iso = isoDateOnly(value);
  if (!iso) return null;
  try {
    return parseDate(iso);
  } catch {
    return null;
  }
}

/** ISO date string for a DatePicker value; '' when cleared. */
export function fromDateValue(value: DateValue | null): string {
  return value ? value.toString().slice(0, 10) : '';
}

// The tenant's payment currency is an ISO 4217 code resolved by the tenant
// bootstrap; the platform default (and the page's old hard-coded symbol) is EUR.
const DEFAULT_CURRENCY = 'EUR';

/** "£" for GBP, "€" for EUR, … — falls back to the code itself for an unknown one. */
export function currencySymbol(currency: string): string {
  try {
    const part = new Intl.NumberFormat(getFormattingLocale(), { style: 'currency', currency })
      .formatToParts(0)
      .find((p) => p.type === 'currency');
    return part?.value ?? currency;
  } catch {
    return currency;
  }
}

/** Tenant-currency formatting and translated type labels, shared by page and modals. */
export function useInsuranceFormatting() {
  const { t } = useTranslation('broker');
  const { tenant } = useTenant();
  const currency = (tenant?.currency || DEFAULT_CURRENCY).toUpperCase();
  const symbol = currencySymbol(currency);

  const formatCoverage = useCallback(
    (amount: number | string | null | undefined): string => {
      const value = Number(amount);
      if (!Number.isFinite(value)) return '—';
      try {
        return formatCurrency(value, currency);
      } catch {
        return `${symbol}${value.toLocaleString(getFormattingLocale())}`;
      }
    },
    [currency, symbol],
  );

  const formatInsuranceType = useCallback(
    (type: string | null | undefined): string => {
      if (!type) return '—';
      const key = INSURANCE_TYPE_LABEL_KEYS[type as InsuranceTypeKey];
      return key ? t(key) : type;
    },
    [t],
  );

  return { currency, symbol, formatCoverage, formatInsuranceType };
}

/** Query the list endpoint accepts; `user_id` and `per_page` are honoured server-side. */
export interface InsuranceListParams {
  status?: string;
  expiring_soon?: boolean;
  search?: string;
  user_id?: string;
}

export const INSURANCE_EXPORT_PAGE_SIZE = 100;

/**
 * One page of certificates, in the shape `collectRows` / `useCsvExport`
 * consume. Throws on a failed response so an export stops rather than
 * silently writing a short file.
 */
export async function fetchInsurancePage(
  params: InsuranceListParams,
  page: number,
  perPage = INSURANCE_EXPORT_PAGE_SIZE,
): Promise<CsvPage<InsuranceCertificate> & { total: number | null }> {
  const res = await adminInsurance.list(
    { ...params, page, per_page: perPage } as Parameters<typeof adminInsurance.list>[0],
  );
  if (!res.success || !Array.isArray(res.data)) {
    throw new Error('insurance list failed');
  }
  const rows = res.data as InsuranceCertificate[];
  const meta = (res.meta ?? {}) as Record<string, unknown>;
  const total = Number(meta.total ?? meta.total_items ?? NaN);
  const lastPage = Number(meta.last_page ?? meta.total_pages ?? NaN);
  const hasMore = Number.isFinite(lastPage)
    ? page < lastPage
    : Number.isFinite(total)
      ? page * perPage < total
      : rows.length === perPage;
  return { rows, hasMore, total: Number.isFinite(total) ? total : null };
}
