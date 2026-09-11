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
  /**
   * The community's numeric id.
   *
   * 🔴 The API has always sent this — `TenantBootstrapController::buildBootstrapData`
   * puts it first, on every one of the three return paths — and this interface simply did
   * not declare it, so nothing in the app could compare the community it is showing
   * against the one a session was issued for. That gap is the whole reason a
   * sub-community member signing in at their hub ended up refused on every request.
   */
  id: number;
  name: string;
  slug: string;
  /** Uppercase ISO 4217 payment currency resolved by the tenant bootstrap. */
  currency?: string;
  tagline: string | null;
  branding: TenantBranding;
  features: Record<string, boolean>;
  modules: Record<string, boolean>;
  volunteering_config?: Record<string, unknown>;
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
  /**
   * The community's own contact details, when it has published any.
   *
   * `TenantBootstrapController::buildContactData()` omits each field it has no
   * value for, so every one is optional and the whole object can be absent — a
   * community that has set nothing simply has no contact block. Surfaced on the
   * Contact screen so a member always has a route to their organisers even when
   * the form itself is refused.
   */
  contact?: {
    email?: string;
    phone?: string;
    address?: string;
    location?: string;
  } | null;
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
 * The same bootstrap, for a community that is NOT the selected one, and without
 * changing anything that is stored.
 *
 * 🔴 This exists so the community picker can find out whether a community can be
 * loaded BEFORE it signs the member out. Switching community necessarily ends the
 * session — a token issued by one community is refused by another — and the picker
 * used to sign out first and discover the new community was unreachable second,
 * which cost the member their session and gave them nothing for it.
 *
 * Sent anonymously on purpose. Bootstrap is what the app calls on a fresh install
 * before anyone has signed in, so it needs no token; and sending the CURRENT
 * community's token while asking about a DIFFERENT one is the exact thing the
 * server answers with `403 "Token tenant does not match requested tenant"` — the
 * same trap that once made the community picker itself unloadable.
 */
export function getTenantConfigFor(slug: string): Promise<{ data: TenantConfig }> {
  return api.get<{ data: TenantConfig }>(`${API_V2}/tenant/bootstrap`, undefined, {
    anonymous: true,
    tenantSlug: slug,
  });
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
