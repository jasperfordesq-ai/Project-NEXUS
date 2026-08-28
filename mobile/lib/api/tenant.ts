// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export interface TenantBranding {
  logo_url: string | null;
  primary_color: string;
  favicon_url: string | null;
  og_image_url: string | null;
}

export interface TenantConfig {
  name: string;
  slug: string;
  /** Uppercase ISO 4217 payment currency resolved by the tenant bootstrap. */
  currency?: string;
  tagline: string | null;
  branding: TenantBranding;
  features: Record<string, boolean>;
  modules: Record<string, boolean>;
  config: {
    time_unit: string;
    time_unit_plural: string;
    footer_text: string | null;
  };
  /**
   * Public `general.*` tenant settings. `region` (ISO 3166-1 alpha-2) drives
   * date and number formatting — see lib/utils/regionStore. Absent when the
   * community has not set one, in which case the platform default applies.
   */
  settings?: {
    region?: string | null;
  } & Record<string, unknown>;
  supported_languages: string[];
  default_language: string;
}

export interface TenantListItem {
  id: number;
  slug: string;
  name: string;
  logo_url: string | null;
}

/** GET /api/v2/tenant/bootstrap — config & branding for the active tenant (from X-Tenant-Slug header) */
export function getTenantConfig(): Promise<{ data: TenantConfig }> {
  return api.get<{ data: TenantConfig }>(`${API_V2}/tenant/bootstrap`);
}

/**
 * GET /api/v2/tenants — public list of available tenants (for tenant picker)
 *
 * 🔴 Deliberately sent WITHOUT the stored token. This list is public, and sending a token
 * is what broke it: a member sitting in a community their account does not belong to gets
 * 403 on everything the token touches, so the picker — the only screen that could put them
 * back — could not load. Measured on a device on 2026-08-24. See `RequestOptions.anonymous`.
 */
export function listTenants(): Promise<{ data: TenantListItem[] }> {
  return api.get<{ data: TenantListItem[] }>(`${API_V2}/tenants`, undefined, { anonymous: true });
}
